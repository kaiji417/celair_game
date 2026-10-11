import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

// ---- 型定義（shared/types.tsと同期） ----

export interface Team {
  id: string;
  name: string;
  points: number;
  hasDevice?: boolean;
}

export type JoinTeamResult =
  | { ok: true; team: Team; token: string }
  | { ok: false; reason: 'taken' | 'closed' | 'invalid' };

const ADMIN_TOKEN_KEY = 'celiar-admin-token';
const TEAM_NAME_KEY = 'celiar-team-name';
const TEAM_TOKEN_KEY = 'celiar-team-token';

function loadSaved(): { name: string | null; token: string | null } {
  try {
    return { name: localStorage.getItem(TEAM_NAME_KEY), token: localStorage.getItem(TEAM_TOKEN_KEY) };
  } catch { return { name: null, token: null }; }
}

export type SubmitResult = 'ok' | 'offline' | 'closed' | 'noTeam' | 'rejected';

export function clearSavedTeam(): void {
  try {
    localStorage.removeItem(TEAM_NAME_KEY);
    localStorage.removeItem(TEAM_TOKEN_KEY);
  } catch {}
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface Quiz {
  id: string;
  question: string;
  options: QuizOption[];
  correctOptionId?: string;
  prizePool: number;
  status: 'waiting' | 'answering' | 'closed' | 'revealed';
  isLastQuiz?: boolean;
}

export interface Answer {
  teamId: string;
  quizId: string;
  optionId: string;
}

export interface GameState {
  teams: Team[];
  quizzes: Quiz[];
  currentQuizIndex: number;
  answers: Answer[];
  phase: 'lobby' | 'playing' | 'finished';
  rankingHidden: boolean;
  teamSlots: string[];
  finalReveal?: FinalRevealState | null;
}

/** 誰がどれに投票したかを伏せるか（shared/types.ts の isVoteHidden と同じ判定。最終問題以降は伏せる） */
export function isVoteHidden(state: Pick<GameState, 'rankingHidden'>, _quiz?: unknown): boolean {
  return !!state.rankingHidden;
}

// 最終結果発表（shared/types.ts と同期）
export type FinalStageKind = 'intro' | 'lower' | 'podium' | 'champion' | 'ranking';
export interface FinalTeam { id: string; name: string; points: number; rank: number }
export interface FinalStage { kind: FinalStageKind; rank?: number; teams: FinalTeam[] }
export interface FinalRevealState { step: number; stages: FinalStage[] }

/** 最終発表で、今表示している段（未開始ならnull） */
export function currentFinalStage(state: GameState | null): FinalStage | null {
  const fr = state?.finalReveal;
  return fr ? fr.stages[fr.step] ?? null : null;
}

export interface AnswerResult {
  teamId: string;
  teamName: string;
  optionId?: string;
  won: boolean;
  received: number;
  delta: number;
  newPoints: number;
}

export interface RevealAnswerResult {
  correctOptionId?: string;
  prizePool: number;
  perWinner: number;
  winnerCount: number;
  results: AnswerResult[];
  noWinner: boolean;
  hidden?: boolean; // ランキング非表示中の発表（正解チーム数・獲得額は伏せてある）
}

// 正解確定演出の尺
// 「正解発表」を押してから一拍置き、不正解を暗くするのと正解の印を出すのを同時に行う。
export const VERDICT_SUSPENSE_MS = 2500;

/** 正解が確定するまでの所要時間（選択肢の数によらず一定） */
export function calcVerdictDuration(_optionCount: number): number {
  return VERDICT_SUSPENSE_MS;
}

/**
 * 参加者画面に結果を出すまでの待ち時間。
 * ディスプレイ側で正解が確定する前にスマホに答えが出ると先バレするため、
 * 消去演出の尺に一拍足してから表示する。
 */
export function calcPlayerResultDelay(optionCount: number): number {
  return calcVerdictDuration(optionCount) + 600;
}


// ---- プレイヤーフック ----

export function usePlayerSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  // 会場のWi-Fiは不安定になりがち。切断に気づかず「回答したつもり」になるのを防ぐ
  const [connected, setConnected] = useState(true);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AnswerResult | null>(null);
  // 結果通知に「正解は何だったか」「全体でどうだったか」を出すため、発表内容ごと保持する
  const [lastReveal, setLastReveal] = useState<{
    payload: RevealAnswerResult;
    correctText: string;
    myOptionText: string | null;
  } | null>(null);
  const [frozenPoints, setFrozenPoints] = useState<number | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  // 自分の回答内容をローカルに保持（サーバーからは選択内容が除去されるため）
  const [myAnswerDetail, setMyAnswerDetail] = useState<{ optionId: string; quizId: string } | null>(() => {
    try {
      const saved = sessionStorage.getItem('celiar-answer-detail');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  useEffect(() => {
    const newSocket = io(`${SERVER_URL}/player`);
    setSocket(newSocket);

    newSocket.on('connect', () => setConnected(true));
    newSocket.on('disconnect', () => setConnected(false));

    // 管理者に端末の紐付けを外された・チームが削除された → 登録画面に戻す
    newSocket.on('deviceReleased', () => {
      clearSavedTeam();
      setTeam(null);
      setTeamId(null);
    });

    newSocket.on('gameState', (state: GameState) => setGameState(state));

    newSocket.on('sessionId', (id: string) => {
      const savedSessionId = localStorage.getItem('celiar-session-id');
      localStorage.setItem('celiar-session-id', id);
      if (savedSessionId !== id) {
        // セッションが変わった（リセットされた）→ チーム情報を消して登録画面へ
        clearSavedTeam();
        setTeam(null);
        setTeamId(null);
        setSessionReady(true);
        return;
      }
      // サーバーは接続のたびに sessionId を送る。再接続のたびにトークンでチームに復帰し直す
      // （スマホのスリープ・Wi-Fi瞬断で socket が入れ替わっても回答できるように）
      const saved = loadSaved();
      if (!saved.name || !saved.token) { setSessionReady(true); return; }
      newSocket.emit('joinTeam', { teamName: saved.name, token: saved.token }, (result: JoinTeamResult) => {
        if (result.ok) {
          setTeam(result.team);
          setTeamId(result.team.id);
        } else {
          // 管理者に端末を外された・チームが削除された等
          clearSavedTeam();
          setTeam(null);
          setTeamId(null);
        }
        setSessionReady(true);
      });
    });

    newSocket.on('resultRevealed', (payload: RevealAnswerResult) => {
      // 演出中はポイント表示を凍結
      setTeamId((currentTeamId) => {
        if (currentTeamId) {
          setGameState((currentState) => {
            if (currentState) {
              const currentTeam = currentState.teams.find((t) => t.id === currentTeamId);
              if (currentTeam) setFrozenPoints(currentTeam.points);
            }
            return currentState;
          });
        }
        return currentTeamId;
      });

      // ディスプレイ側の消去演出が終わるのを待ってから結果を出す（先バレ防止）
      setGameState((currentState) => {
        const quiz = currentState?.quizzes[currentState.currentQuizIndex];
        const optionCount = quiz?.options.length ?? 4;
        const textOf = (id?: string) => quiz?.options.find((o) => o.id === id)?.text ?? null;

        setTimeout(() => {
          setTeamId((currentTeamId) => {
            if (currentTeamId) {
              const myResult = payload.results.find((r) => r.teamId === currentTeamId);
              if (myResult) {
                setLastReveal({
                  payload,
                  correctText: textOf(payload.correctOptionId) ?? '',
                  myOptionText: textOf(myResult.optionId),
                });
                setLastResult(myResult);
              }
            }
            return currentTeamId;
          });
          setFrozenPoints(null);
        }, calcPlayerResultDelay(optionCount));

        return currentState;
      });
    });

    return () => { newSocket.close(); };
  }, []);

  useEffect(() => {
    if (teamId && gameState) {
      const updatedTeam = gameState.teams.find((t) => t.id === teamId);
      if (updatedTeam) setTeam(updatedTeam);
    }
  }, [gameState, teamId]);

  const joinTeam = useCallback((teamName: string): Promise<JoinTeamResult> => {
    return new Promise((resolve) => {
      if (!socket) { resolve({ ok: false, reason: 'invalid' }); return; }
      const saved = loadSaved();
      const token = saved.name?.toLowerCase() === teamName.toLowerCase() ? saved.token ?? undefined : undefined;
      socket.emit('joinTeam', { teamName, token }, (result: JoinTeamResult) => {
        if (result.ok) {
          setTeam(result.team);
          setTeamId(result.team.id);
          try {
            localStorage.setItem(TEAM_NAME_KEY, result.team.name);
            localStorage.setItem(TEAM_TOKEN_KEY, result.token);
          } catch {}
        }
        resolve(result);
      });
    });
  }, [socket]);

  // ロビー中にチームを選び直す
  const leaveTeam = useCallback(() => {
    const saved = loadSaved();
    if (socket && saved.token) socket.emit('leaveTeam', saved.token);
    clearSavedTeam();
    setTeam(null);
    setTeamId(null);
  }, [socket]);

  // 選択肢を選んで送信
  // 失敗理由は画面の文言を出し分けるために返す
  const submitAnswer = useCallback((optionId: string): Promise<SubmitResult> => {
    return new Promise((resolve) => {
      if (!socket || !gameState || !socket.connected) { resolve('offline'); return; }
      const quiz = gameState.quizzes[gameState.currentQuizIndex];
      if (!quiz || quiz.status !== 'answering') { resolve('closed'); return; }
      const token = loadSaved().token;
      if (!token) { resolve('noTeam'); return; }
      // 応答が返らないまま固まらないようタイムアウトを付ける
      socket.timeout(5000).emit('submitAnswer', { optionId, quizId: quiz.id, token }, (err: Error | null, success: boolean) => {
        if (err) { resolve('offline'); return; }
        if (!success) { resolve('rejected'); return; }
        const detail = { optionId, quizId: quiz.id };
        setMyAnswerDetail(detail);
        try { sessionStorage.setItem('celiar-answer-detail', JSON.stringify(detail)); } catch {}
        resolve('ok');
      });
    });
  }, [socket, gameState]);

  const clearResult = useCallback(() => { setLastResult(null); setLastReveal(null); }, []);

  return { socket, connected, sessionReady, gameState, team, joinTeam, leaveTeam, submitAnswer, lastResult, lastReveal, clearResult, frozenPoints, myAnswerDetail };
}

// ---- 管理者フック ----

export function useAdminSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [adminError, setAdminError] = useState('');
  const [connected, setConnected] = useState(false);

  const openSocket = useCallback((token: string) => {
    const newSocket = io(`${SERVER_URL}/admin`, { auth: { token } });
    newSocket.on('connect', () => { setConnected(true); setAuthenticated(true); setAuthError(''); });
    newSocket.on('disconnect', () => setConnected(false));
    newSocket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        // パスワードが変わった等でトークンが無効
        try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}
        newSocket.close();
        setSocket(null);
        setAuthenticated(false);
        setAuthError('認証の有効期限が切れました。再度ログインしてください');
      }
    });
    newSocket.on('gameState', (state: GameState) => setGameState(state));
    newSocket.on('adminError', (message: string) => setAdminError(message));
    setSocket(newSocket);
  }, []);

  // 再読み込みしてもログインし直さなくて済むよう、タブ単位でトークンを保持する
  useEffect(() => {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(ADMIN_TOKEN_KEY); } catch {}
    if (saved) openSocket(saved);
  }, [openSocket]);

  useEffect(() => () => { socket?.close(); }, [socket]);

  const connect = useCallback(async (password: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) { setAuthError(data.message || 'パスワードが正しくありません'); return; }
      try { sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token); } catch {}
      openSocket(data.token);
    } catch {
      setAuthError('サーバーに接続できません');
    }
  }, [openSocket]);

  const clearAdminError = useCallback(() => setAdminError(''), []);
  const releaseDevice = useCallback((teamId: string) => { socket?.emit('releaseDevice', teamId); }, [socket]);

  const updateQuizzes = useCallback((quizzes: Quiz[]) => {
    socket?.emit('updateQuizzes', quizzes);
  }, [socket]);

  const startQuiz = useCallback((index: number) => {
    socket?.emit('startQuiz', index);
  }, [socket]);

  const closeAnswers = useCallback(() => {
    socket?.emit('closeAnswers');
  }, [socket]);

  // 正解発表（正解の選択肢IDを渡す）
  const revealAnswer = useCallback((payload: { correctOptionId?: string }) => {
    socket?.emit('revealAnswer', payload);
  }, [socket]);

  const resetGame = useCallback(() => { socket?.emit('resetGame'); }, [socket]);
  const fullReset = useCallback(() => { socket?.emit('fullReset'); }, [socket]);
  const removeTeam = useCallback((teamId: string) => { socket?.emit('removeTeam', teamId); }, [socket]);
  const showQrCode = useCallback((url: string) => { socket?.emit('showQrCode', url); }, [socket]);
  const hideQrCode = useCallback(() => { socket?.emit('hideQrCode'); }, [socket]);
  const finalRevealNext = useCallback(() => { socket?.emit('finalRevealNext'); }, [socket]);
  const adjustPoints = useCallback((teamId: string, delta: number) => { socket?.emit('adjustPoints', teamId, delta); }, [socket]);
  const resetAnswer = useCallback((teamId: string) => { socket?.emit('resetAnswer', teamId); }, [socket]);

  const setTeamSlots = useCallback((slots: string[]) => { socket?.emit('setTeamSlots', slots); }, [socket]);

  const showResults = useCallback(() => { socket?.emit('showResults'); }, [socket]);


  return {
    gameState, authenticated, authError, connect, connected, adminError, clearAdminError,
    updateQuizzes, startQuiz, closeAnswers, revealAnswer,
    resetGame, fullReset, removeTeam, releaseDevice, showQrCode, hideQrCode, finalRevealNext,
    adjustPoints, resetAnswer, setTeamSlots, showResults,
  };
}
