import express from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import path from 'path';
import os from 'os';
import { GameManager } from './game';
import { createAdminAuth, createLoginLimiter } from './auth';
import { sanitizeFinalReveal } from './finalReveal';
import { isVoteHidden } from '@ce-liar-game/shared';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  AdminToServerEvents,
  GameState,
} from '@ce-liar-game/shared';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEFAULT_PASSWORD = 'celiar';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

// 公開サーバーでデフォルトパスワードのまま起動させない
if (IS_PRODUCTION && (ADMIN_PASSWORD === DEFAULT_PASSWORD || ADMIN_PASSWORD.length < 8)) {
  console.error('ADMIN_PASSWORD を8文字以上の独自の値に設定してください（本番ではデフォルト値で起動できません）');
  process.exit(1);
}

const adminAuth = createAdminAuth(ADMIN_PASSWORD);
const loginLimiter = createLoginLimiter();

const app = express();
// Render 等のリバースプロキシ配下で正しいクライアントIPを取る（ログイン試行制限用）
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

// フロントとAPIは同一オリジンで配信するので CORS は開けない（開発時は Vite のプロキシ経由）
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

const httpServer = createServer(app);
const io = new Server<
  ClientToServerEvents & AdminToServerEvents,
  ServerToClientEvents
>(httpServer, {
  maxHttpBufferSize: 1e6,
});

const game = new GameManager();
game.load();

// プレイヤー・ディスプレイに送るgameStateからネタバレ情報を除去する
// （正解・未締切の回答内容を除去。クライアント側では省略フィールドをundefinedとして扱う）
function sanitizeStateForPlayer(state: GameState): GameState {
  return {
    ...state,
    // 未発表の順位・優勝候補の並び順を伏せる
    finalReveal: sanitizeFinalReveal(state.finalReveal),
    // ランキング非表示中・最終発表中（優勝発表まで）は得点を伏せる。
    // 自チームの得点が分かると、そこから正解チーム数や順位が推測できてしまうため
    teams: (state.finalReveal
      ? state.finalReveal.step < state.finalReveal.stages.length - 1
      : state.rankingHidden)
      // 最終段（全順位）までは得点を伏せる
      ? state.teams.map((t) => ({ ...t, points: 0 }))
      : state.teams,

    // revealed前のクイズから正解情報を除去
    quizzes: state.quizzes.map((q) => {
      if (q.status === 'revealed') return q;
      const { correctOptionId: _a, ...rest } = q;
      return rest as typeof q;
    }),
    // answersから選択内容を除去 — 締め切り後（closed / revealed）は開示してOK。
    // revealedを含めないと正解発表後に全チームの選択が消え、開示ボードが0件になる。
    // ランキング非表示中（＝最終盤）は、誰がどれを選んだかが分かると得点が推測できるので
    // 締め切り後も伏せる（選択肢ごとの人数は answerCounts で別に送る）
    answers: state.answers.map((a) => {
      const quiz = state.quizzes.find((q) => q.id === a.quizId);
      const open = quiz && (quiz.status === 'closed' || quiz.status === 'revealed');
      if (open && !isVoteHidden(state, quiz)) return a;
      const { optionId: _a, ...rest } = a;
      return rest as typeof a;
    }),
  };
}

/**
 * 参加者がアクセスすべきURLを返す。
 * サーバー公開時はアクセス中のホスト名をそのまま使う。
 * ローカルLAN運用時はLAN IPを推定する（会場でIPを手入力させない）。
 */
app.get('/api/player-url', (req, res) => {
  const proto = req.protocol;
  const hostHeader = req.headers.host ?? '';
  const host = hostHeader.split(':')[0];
  const isLocal = !host || host === 'localhost' || host === '127.0.0.1';

  if (!isLocal) {
    res.json({ url: `${proto}://${hostHeader}/player`, candidates: [] });
    return;
  }

  const nets = os.networkInterfaces();
  // VPN/仮想アダプタのIPを拾うとスマホから到達できないURLを案内してしまう
  const VIRTUAL_IF = /vpn|anyconnect|virtual|vmware|hyper-v|vethernet|wsl|loopback|tailscale|zerotier|tap-|tun/i;

  const candidates: { ip: string; iface: string; virtual: boolean }[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push({ ip: net.address, iface: name, virtual: VIRTUAL_IF.test(name) });
    }
  }

  const physical = candidates.filter((c) => !c.virtual);
  const pickFrom = physical.length > 0 ? physical : candidates;
  const preferred = (
    pickFrom.find((c) => /wi-?fi|wlan|wireless/i.test(c.iface)) ??
    pickFrom.find((c) => c.ip.startsWith('192.168.')) ??
    pickFrom.find((c) => c.ip.startsWith('10.')) ??
    pickFrom[0]
  )?.ip;

  const port = process.env.PORT || 3001;
  res.json({
    url: preferred ? `http://${preferred}:${port}/player` : null,
    candidates: [...physical, ...candidates.filter((c) => c.virtual)].map((c) => ({
      url: `http://${c.ip}:${port}/player`,
      iface: c.iface,
      virtual: c.virtual,
    })),
  });
});

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (loginLimiter.isLocked(ip)) {
    res.status(429).json({ success: false, message: '試行回数が多すぎます。しばらく待ってから再度お試しください' });
    return;
  }
  if (adminAuth.checkPassword(req.body?.password)) {
    loginLimiter.succeed(ip);
    res.json({ success: true, token: adminAuth.token });
  } else {
    loginLimiter.fail(ip);
    res.status(401).json({ success: false, message: 'パスワードが正しくありません' });
  }
});

// ---- 参加者用namespace ----
const playerNs = io.of('/player');

/** 紐付けを外したチームの端末に通知し、登録画面に戻させる */
function notifyDeviceReleased(teamId: string): void {
  for (const s of playerNs.sockets.values()) {
    if (s.data.teamId === teamId) {
      s.data.teamId = undefined;
      s.emit('deviceReleased');
    }
  }
}

function broadcastState(): void {
  const state = game.getState();
  adminNs.emit('gameState', state);
  playerNs.emit('gameState', sanitizeStateForPlayer(state));
}

playerNs.on('connection', (socket) => {
  socket.emit('gameState', sanitizeStateForPlayer(game.getState()));
  socket.emit('sessionId', game.getSessionId());

  socket.on('joinTeam', (payload, callback) => {
    if (typeof callback !== 'function') return;
    const teamName = typeof payload?.teamName === 'string' ? payload.teamName : '';
    const token = typeof payload?.token === 'string' ? payload.token : undefined;
    const result = game.joinTeam(teamName, token);
    if (result.ok) {
      socket.data.teamId = result.team.id;
      broadcastState();
    }
    callback(result);
  });

  // チームはsocketではなくトークンから解決する。再接続でsocketが入れ替わっても回答できる
  socket.on('submitAnswer', (answer, callback) => {
    if (typeof callback !== 'function') return;
    const teamId = game.resolveToken(answer?.token);
    if (!teamId || typeof answer?.optionId !== 'string' || typeof answer?.quizId !== 'string') {
      callback(false);
      return;
    }
    const success = game.submitAnswer({ teamId, quizId: answer.quizId, optionId: answer.optionId });
    if (success) broadcastState();
    callback(success);
  });

  socket.on('leaveTeam', (token) => {
    if (typeof token === 'string' && game.leaveTeam(token)) {
      socket.data.teamId = undefined;
      broadcastState();
    }
  });
});

// ---- 管理者用namespace ----
const adminNs = io.of('/admin');

// 接続時にトークンを検証する。未認証のsocketは操作イベントを一切送れない
adminNs.use((socket, next) => {
  if (adminAuth.checkToken(socket.handshake.auth?.token)) return next();
  next(new Error('unauthorized'));
});

type AdminSocket = Socket<ClientToServerEvents & AdminToServerEvents, ServerToClientEvents>;

function reportResult(socket: AdminSocket, result: { ok: true } | { ok: false; message: string }): boolean {
  if (!result.ok) socket.emit('adminError', result.message);
  return result.ok;
}

adminNs.on('connection', (socket) => {
  socket.emit('gameState', game.getState());

  socket.on('updateQuizzes', (quizzes) => {
    if (!Array.isArray(quizzes)) return;
    if (reportResult(socket, game.setQuizzes(quizzes))) broadcastState();
    else socket.emit('gameState', game.getState()); // 管理画面の表示をサーバーの状態に戻す
  });

  socket.on('startQuiz', (quizIndex) => {
    const result = game.startQuiz(Number(quizIndex));
    if (!reportResult(socket, result)) return;
    const state = game.getState();
    // 前の問題の配分画面を閉じる（「結果を閉じる」を押さなくても次へ進めるように）
    playerNs.emit('hideResults');
    broadcastState();
    playerNs.emit('quizStarted', sanitizeStateForPlayer(state).quizzes[state.currentQuizIndex]);
  });

  socket.on('closeAnswers', () => {
    if (!game.closeAnswers()) {
      socket.emit('adminError', '回答受付中のクイズがありません');
      return;
    }
    broadcastState();
    playerNs.emit('answersClosed');
  });

  socket.on('revealAnswer', (payload) => {
    const revealResult = game.revealAnswer(payload ?? {});
    if (!revealResult) {
      socket.emit('adminError', '正解発表できません（締め切り済みでないか、既に発表済みです）');
      return;
    }
    const stateAfterReveal = game.getState();
    const revealedQuizIndex = stateAfterReveal.currentQuizIndex;

    adminNs.emit('gameState', stateAfterReveal);

    if (stateAfterReveal.rankingHidden) {
      // 非表示中は正解チーム数・獲得額を誰にも見せない。各端末には自分のチームの正誤だけを送る。
      // ディスプレイ（チームに紐付かない接続）には選択肢の並びだけを送り、消去演出に使わせる
      for (const s of playerNs.sockets.values()) {
        const mine = revealResult.results.find((r) => r.teamId === s.data.teamId);
        s.emit('resultRevealed', {
          correctOptionId: revealResult.correctOptionId,
          prizePool: revealResult.prizePool,
          perWinner: 0,
          winnerCount: 0,
          noWinner: false,
          hidden: true,
          results: mine ? [{ ...mine, received: 0, delta: 0, newPoints: 0 }] : [],
        });
      }
    } else {
      playerNs.emit('resultRevealed', revealResult);
    }

    // クライアント側の正解発表演出（約2.5秒）が終わった後に状態を再送する。
    // 早すぎると参加者画面に正解が先に届いてしまうため余裕を持たせる。
    setTimeout(() => {
      const currentState = game.getState();
      if (currentState.currentQuizIndex === revealedQuizIndex) {
        playerNs.emit('gameState', sanitizeStateForPlayer(currentState));
      }
    }, 8000);
  });

  socket.on('resetGame', () => {
    game.reset();
    broadcastState();
    playerNs.emit('sessionId', game.getSessionId());
  });

  socket.on('fullReset', () => {
    game.fullReset();
    broadcastState();
    playerNs.emit('sessionId', game.getSessionId());
  });

  socket.on('removeTeam', (teamId) => {
    const id = String(teamId);
    if (game.removeTeam(id)) {
      notifyDeviceReleased(id);
      broadcastState();
    }
  });

  socket.on('releaseDevice', (teamId) => {
    const id = String(teamId);
    if (game.releaseDevice(id)) {
      notifyDeviceReleased(id);
      broadcastState();
    }
  });

  socket.on('showQrCode', (url) => {
    if (typeof url === 'string' && url.length < 500) playerNs.emit('showQrCode', url);
  });

  socket.on('hideQrCode', () => {
    playerNs.emit('hideQrCode');
  });

  socket.on('setTeamSlots', (slots) => {
    if (!Array.isArray(slots)) return;
    game.setTeamSlots(slots.filter((s): s is string => typeof s === 'string').map((s) => s.trim().slice(0, 30)));
    broadcastState();
  });

  socket.on('adjustPoints', (teamId, delta) => {
    if (game.adjustPoints(String(teamId), Number(delta))) broadcastState();
  });

  socket.on('resetAnswer', (teamId) => {
    if (game.resetAnswer(String(teamId))) broadcastState();
  });

  // 最終結果発表は司会のペースで1段ずつ進める。状態はgameStateで配る（リロードしても復帰できる）
  socket.on('finalRevealNext', () => {
    if (reportResult(socket, game.advanceFinalReveal())) broadcastState();
  });

  socket.on('showResults', () => {
    playerNs.emit('showResults');
  });

});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  if (ADMIN_PASSWORD === DEFAULT_PASSWORD) {
    console.warn('⚠ ADMIN_PASSWORD が未設定です（デフォルト値で起動中）。ローカル確認以外では設定してください');
  }
});
