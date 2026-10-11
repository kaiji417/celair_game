import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import type { GameState, AnswerResult, Team, Quiz, RevealAnswerResult } from '../hooks/useSocket';
import { useCountUp } from '../lib/useCountUp';
import { calcRankMovement } from '../lib/ranking';

// 分配画面: 発表前の順位で一度見せてから、並び替えを始めるまでの間
const PAYOUT_RESORT_DELAY_MS = 1800;
// 総取りの全面表示の長さ
const MONOPOLY_INTRO_MS = 4500;
// 最終問題の予告を出す長さ
const FINAL_PREVIEW_MS = 4000;
import { calcVerdictDuration, isVoteHidden } from '../hooks/useSocket';
import type { FinalRevealState, FinalTeam } from '../hooks/useSocket';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

// disclosure: 回答開示（締め切り後、全チームの選択を公開）
// verdict:    正解確定（開示のレイアウトを保ったまま正解列を強調）
// payout:     山分け結果
type RevealPhase = 'idle' | 'disclosure' | 'verdict' | 'payout';


// 標準ランキング方式（1,1,1,4...）
function calcRankedTeams(teams: Team[]): (Team & { rank: number })[] {
  const result: (Team & { rank: number })[] = [];
  for (let i = 0; i < teams.length; i++) {
    if (i === 0) {
      result.push({ ...teams[i], rank: 1 });
    } else {
      const prev = teams[i - 1];
      const prevRank = result[i - 1].rank;
      result.push({ ...teams[i], rank: teams[i].points === prev.points ? prevRank : i + 1 });
    }
  }
  return result;
}

type OptionColumn = {
  id: string;
  text: string;
  teamNames: string[];
  count: number;
};

/** 選択肢ごとに回答チームをまとめる */
function buildColumns(quiz: Quiz, gameState: GameState): OptionColumn[] {
  const quizAnswers = gameState.answers.filter((a) => a.quizId === quiz.id);
  return quiz.options.map((opt) => {
    const teamNames = quizAnswers
      .filter((a) => a.optionId === opt.id)
      .map((a) => gameState.teams.find((t) => t.id === a.teamId)?.name)
      .filter((n): n is string => !!n);
    return { id: opt.id, text: opt.text, teamNames, count: teamNames.length };
  });
}

/**
 * 回答開示ボード。
 * 選択肢を列に並べ、各列にその選択肢を選んだチームを積む。
 * 多数派・少数派が一目で分かることがこの演出の主眼。
 *
 * 正解発表では不正解の列を1つずつ消し、最後に残った列を正解として確定させる。
 * 状態は列の見た目（消し線・金枠・印判）で示し、説明ラベルは置かない。
 */
function DisclosureBoard({
  quiz,
  gameState,
  correctOptionId,
  eliminatedIds,
  settled,
}: {
  quiz: Quiz;
  gameState: GameState;
  correctOptionId?: string;
  eliminatedIds: string[];
  settled: boolean;
}) {
  const columns = buildColumns(quiz, gameState);
  // 最終問題・ランキング非表示中は、誰がどれに投票したか（チーム名・人数）を出さない
  const votesHidden = isVoteHidden(gameState, quiz);
  const counts = columns.map((c) => c.count);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  // 全列が同数なら多数派/少数派の区別をしない（伏せているときは区別しようがない）
  const hasSpread = !votesHidden && max !== min;

  const unanswered = gameState.teams.filter(
    (t) => !gameState.answers.some((a) => a.quizId === quiz.id && a.teamId === t.id)
  );

  // 1列に多くのチームが集まると1080pの縦に収まらないので、列内を2段組みにして詰める
  const dense = max > 8 ? (columns.length <= 2 ? 'is-dense-wide' : 'is-dense') : '';

  return (
    <div className={`disclosure ${dense}`}>
      {/* 状態を説明するラベルは置かない。金枠と印判が付くので見れば分かる */}
      <div className="disclosure-head">
        <p className="disclosure-question">{quiz.question}</p>
        <p className="disclosure-prize">配分総額 {quiz.prizePool.toLocaleString()} pt</p>
      </div>

      <div className={`disclosure-columns cols-${columns.length}`}>
        {columns.map((col) => {
          const isEliminated = eliminatedIds.includes(col.id);
          // 消去が全て終わって初めて正解として確定させる
          const isCorrect = settled && col.id === correctOptionId;
          const spreadClass = !hasSpread
            ? ''
            : col.count === max
              ? 'is-major'
              : col.count === min
                ? 'is-minor'
                : '';
          return (
            <div
              key={col.id}
              className={`disclosure-col ${spreadClass} ${isEliminated ? 'is-eliminated' : ''} ${isCorrect ? 'is-correct' : ''}`}
            >
              {/* 印判は flex で中央に置く。transform で中央寄せすると列の拡大・揺れと干渉してずれる */}
              {isCorrect && (
                <div className="disclosure-stamp-layer" aria-hidden="true">
                  <span className="disclosure-stamp">正解</span>
                </div>
              )}
              <div className="disclosure-col-head">
                <span className="option-key">{String.fromCharCode(65 + columns.indexOf(col))}</span>
                <span className="disclosure-col-text">{col.text}</span>
                {!votesHidden && <span className="disclosure-col-count">{col.count}</span>}
              </div>
              {!votesHidden && (
                <div className="disclosure-col-body">
                  {col.teamNames.length === 0 ? (
                    <p className="disclosure-empty">なし</p>
                  ) : (
                    col.teamNames.map((name) => (
                      <p key={name} className="disclosure-team">{name}</p>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {votesHidden ? (
        <p className="disclosure-unanswered">回答 非公開</p>
      ) : unanswered.length > 0 && (
        <p className="disclosure-unanswered">
          未回答 {unanswered.length}チーム: {unanswered.map((t) => t.name).join('  ')}
        </p>
      )}
    </div>
  );
}

/**
 * 分配と順位変動の画面。
 * 1) 配分総額 ÷ 正解チーム数 = 1チームの取り分、を式として見せる
 * 2) その下でランキングが「発表前の順」から「発表後の順」へ並び替わる
 * 少数正解で一気に順位が上がる瞬間が、このゲームの一番の見せ場。
 */
function PayoutBoard({
  payload,
  results,
  hidePoints,
}: {
  payload: RevealAnswerResult;
  results: AnswerResult[];
  hidePoints: boolean;
}) {
  const { prizePool, perWinner, winnerCount, noWinner } = payload;
  const isMonopoly = winnerCount === 1;
  const movement = calcRankMovement(results);

  // まず発表前の順で並べ、少し置いてから発表後の順へ動かす
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), PAYOUT_RESORT_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const sorted = [...results].sort((a, b) => {
    const ma = movement.get(a.teamId)!;
    const mb = movement.get(b.teamId)!;
    return settled
      ? ma.newRank - mb.newRank || b.newPoints - a.newPoints
      : ma.prevRank - mb.prevRank || (b.newPoints - b.received) - (a.newPoints - a.received);
  });

  // 行の位置をtransformで動かすため、表示順のインデックスを各チームに割り当てる。
  // 1080pの縦に収まるよう、チーム数が多いほど行を詰める
  const ROW_H = results.length > 14 ? 42 : results.length > 9 ? 52 : 64;
  const indexOf = new Map(sorted.map((r, i) => [r.teamId, i]));
  const shownPerWinner = useCountUp(perWinner, { from: 0, duration: 1000, delay: 500 });

  // 総取り（1チームだけ正解）は、まずチーム名を全面に出してから通常の配分画面へ移る
  const monopolist = isMonopoly ? results.find((r) => r.won) : undefined;
  const [monopolyIntro, setMonopolyIntro] = useState(!!monopolist);
  useEffect(() => {
    if (!monopolist) return;
    const t = setTimeout(() => setMonopolyIntro(false), MONOPOLY_INTRO_MS);
    return () => clearTimeout(t);
  }, [monopolist]);

  if (monopolist && monopolyIntro) {
    return (
      <div className="monopoly-screen">
        <p className="monopoly-label">総取り</p>
        <p className="monopoly-team">{monopolist.teamName}</p>
        <p className="monopoly-amount">
          {hidePoints ? '??? pt' : `+${prizePool.toLocaleString()} pt`}
        </p>

      </div>
    );
  }

  // 非表示中（最終盤）は正解チーム数・獲得額・順位の動きを一切出さない
  if (payload.hidden || hidePoints) {
    return (
      <div className="payout">
        <div className="payout-equation payout-headline">
          <span className="payout-headline-label">結果は最後に</span>
          <span className="payout-eq-share">???<small> pt</small></span>
        </div>
        <MaskedRanking teamCount={results.length || 8} />
      </div>
    );
  }

  return (
    <div className="payout">
      {noWinner ? (
        <div className="payout-equation payout-headline is-none">
          <span className="payout-headline-label">全チーム不正解</span>
        </div>
      ) : (
        /* 計算式は出さず「正解◯チームに +◯◯pt」とだけ見せる */
        <div className={`payout-equation payout-headline ${isMonopoly ? 'is-monopoly' : ''}`}>
          <span className="payout-headline-label">正解 {winnerCount}チームに</span>
          <span className="payout-eq-share">
            {hidePoints ? '???' : `+${shownPerWinner.toLocaleString()}`}
            <small> pt</small>
          </span>
          {isMonopoly && <span className="payout-eq-tag">総取り</span>}
        </div>
      )}

      {(
        <div
          className={`payout-ranking ${ROW_H < 64 ? (ROW_H < 52 ? 'is-ultra' : 'is-compact') : ''}`}
          style={{ height: sorted.length * ROW_H }}
        >
          {results.map((r) => {
            const m = movement.get(r.teamId)!;
            const i = indexOf.get(r.teamId)!;
            const rank = settled ? m.newRank : m.prevRank;
            return (
              <div
                key={r.teamId}
                className={`payout-row ${r.won ? 'is-win' : ''} ${settled && m.delta > 0 ? 'is-rise' : ''}`}
                style={{ transform: `translateY(${i * ROW_H}px)` }}
              >
                <span className="payout-row-rank">{rank}</span>
                <span className="payout-row-name">{r.teamName}</span>
                <span className="payout-row-gain">
                  {r.won ? `+${r.received.toLocaleString()}` : ''}
                </span>
                <span className="payout-row-total">
                  {(settled ? r.newPoints : r.newPoints - r.received).toLocaleString()}
                  <small> pt</small>
                </span>
                <span className="payout-row-move">
                  {settled && m.delta > 0 && <span className="is-up">▲{m.delta}</span>}
                  {settled && m.delta < 0 && <span className="is-down">▼{-m.delta}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 非公開中のランキング。
 * 実際のチーム名・得点は描画せず、ダミーの帯を並べてぼかす。
 * 「隠している」ことがランキングの形で伝わる一方、DOMには本物が出ないので漏れない。
 */
function MaskedRanking({ teamCount }: { teamCount: number }) {
  // 行ごとに幅を変えて、実データが入っているように見せる
  const rows = Array.from({ length: Math.max(teamCount, 5) }, (_, i) => ({
    nameWidth: 38 + ((i * 17) % 34),
    pointsWidth: 44 + ((i * 11) % 28),
  }));

  return (
    <div className="ranking-masked">
      <div className="ranking-masked-rows" aria-hidden="true">
        {rows.map((r, i) => (
          <div key={i} className="ranking-masked-row">
            <span className="masked-block masked-rank" />
            <span className="masked-block masked-name" style={{ width: `${r.nameWidth}%` }} />
            <span className="masked-block masked-points" style={{ width: `${r.pointsWidth}px` }} />
          </div>
        ))}
      </div>
      <div className="ranking-masked-overlay">
        <p className="ranking-masked-text">最終結果をお楽しみに</p>
        <p className="ranking-masked-sub">順位と得点は最後に発表します</p>
      </div>
    </div>
  );
}

/** 最終発表の1行 */
function FinalRow({ t, enter }: { t: FinalTeam; enter?: boolean }) {
  return (
    <div className={`final-ranking-row ${t.rank <= 3 ? `final-top-${t.rank}` : ''} ${enter ? 'final-row-enter' : ''}`}>
      <span className="final-rank">{t.rank}</span>
      <span className="final-team-name">{t.name}</span>
      <span className="final-points">{t.points.toLocaleString()} pt</span>
    </div>
  );
}

/**
 * 最終結果発表。司会が1段ずつ進める。
 *   intro → 4位以下(まとめて) → 3位 → 2位 → 優勝＋全順位
 * 発表済みの順位は下に積んでいき、今発表した段だけを大きく見せる。
 */
function FinalRevealBoard({ state }: { state: FinalRevealState }) {
  const stage = state.stages[state.step];
  if (!stage) return null;

  if (stage.kind === 'intro') {
    return (
      <div className="announce-content final-intro">
        <img src="/logo-stacked.png" alt="CELIAR GAME" className="announce-logo" />
        <p className="announce-title announce-title-ja">最終結果発表</p>
      </div>
    );
  }

  // 優勝チームだけを画面中央に大きく出す（全順位は次の段）
  if (stage.kind === 'champion') {
    const champions = stage.teams;
    const isTie = champions.length > 1;
    return (
      <div className="champion-screen champion-solo">
        <div className="champion-reveal">
          <p className="champion-label">{isTie ? '同率優勝' : '優勝'}</p>
          <div className={`champion-names ${isTie ? 'is-tie' : ''}`}>
            {champions.map((c) => <p key={c.id} className="champion-name">{c.name}</p>)}
          </div>
          <p className="champion-points">{champions[0]?.points.toLocaleString()} pt</p>
        </div>
      </div>
    );
  }

  // 全順位。2列に流す。行数はチーム数の半分（端数切り上げ）
  if (stage.kind === 'ranking') {
    const ranked = stage.teams;
    return (
      <div className="final-stage final-ranking-stage">
        <p className="final-stage-label">最終順位</p>
        <div
          className="final-ranking-list champion-ranking ranking-solo"
          style={{ ['--rows' as string]: Math.ceil(ranked.length / 2) }}
        >
          {ranked.map((t) => <FinalRow key={t.id} t={t} enter />)}
        </div>
      </div>
    );
  }

  // これまでに発表した順位（今の段より前の lower / podium）
  const announced = state.stages
    .slice(0, state.step)
    .filter((s) => s.kind === 'lower' || s.kind === 'podium')
    .flatMap((s) => s.teams)
    .sort((a, b) => a.rank - b.rank);

  // lower / podium
  const isPodium = stage.kind === 'podium';
  // チーム数が多いと4位以下が縦に溢れるので行を詰める（16チームで4位以下13行）
  const lowerDensity = stage.teams.length > 12 ? 'final-ultra' : stage.teams.length > 7 ? 'final-compact' : '';
  return (
    <div className="final-stage">
      <p className="final-stage-label">{isPodium ? `第${stage.rank}位` : '4位以下'}</p>
      {isPodium ? (
        <div className="podium-teams">
          {stage.teams.map((t) => (
            <div key={t.id} className="podium-team final-row-enter">
              <span className="podium-name">{t.name}</span>
              <span className="podium-points">{t.points.toLocaleString()} pt</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={`final-ranking-list ${lowerDensity}`}>
          {stage.teams.slice().sort((a, b) => a.rank - b.rank).map((t) => <FinalRow key={t.id} t={t} enter />)}
        </div>
      )}
      {isPodium && announced.length > 0 && (
        <div className={`final-ranking-list final-announced ${announced.length > 8 ? 'final-ultra' : 'final-compact'}`}>
          {announced.map((t) => <FinalRow key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

function DisplayPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [revealPhase, setRevealPhase] = useState<RevealPhase>('idle');
  const [lastResults, setLastResults] = useState<AnswerResult[]>([]);
  const [revealPayload, setRevealPayload] = useState<RevealAnswerResult | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  // 消去済みの選択肢と、消去完了フラグ（正解確定）
  const [eliminatedIds, setEliminatedIds] = useState<string[]>([]);
  const [settled, setSettled] = useState(false);
  // 演出を実行中か。これが立っている間は gameState 由来で確定させない
  const [verdictRunning, setVerdictRunning] = useState(false);
  // 切断に気づけるよう隅に表示する（初回接続前は出さない）
  const [connected, setConnected] = useState(true);

  // sessionStorageから復元
  // 最終問題の出題直後に出す FINAL 予告（quizId を持っている間だけ表示）
  const [finalPreviewQuizId, setFinalPreviewQuizId] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(`${SERVER_URL}/player`);

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('gameState', (state: GameState) => setGameState(state));

    socket.on('quizStarted', (quiz: Quiz) => {
      if (!quiz?.isLastQuiz) return;
      setFinalPreviewQuizId(quiz.id);
      setTimeout(() => setFinalPreviewQuizId((id) => (id === quiz.id ? null : id)), FINAL_PREVIEW_MS);
    });

    socket.on('answersClosed', () => {
      setRevealPayload(null);
      setLastResults([]);
      setEliminatedIds([]);
      setSettled(false);
      setRevealPhase('disclosure');
    });

    // 開示のレイアウトのまま溜めを作り、不正解を暗くするのと正解の印を出すのを同時に行う。
    // 先に暗くすると、印が出る前に残った列で正解が分かってしまうため
    socket.on('resultRevealed', (payload: RevealAnswerResult) => {
      setRevealPayload(payload);
      setLastResults(payload.results);
      setEliminatedIds([]);
      setSettled(false);
      setVerdictRunning(true);
      setRevealPhase('verdict');

      setGameState((state) => {
        const quiz = state?.quizzes[state.currentQuizIndex];
        if (!quiz) return state;
        const wrongIds = quiz.options.map((o) => o.id).filter((id) => id !== payload.correctOptionId);
        // 溜めの長さは参加者のスマホに結果を出すタイミング（calcVerdictDuration）と揃える
        setTimeout(() => {
          setEliminatedIds(wrongIds);
          setSettled(true);
          setVerdictRunning(false);
        }, calcVerdictDuration(quiz.options.length));
        return state;
      });
    });

    socket.on('showResults', () => {
      setRevealPhase('payout');
    });

    socket.on('hideResults', () => {
      setRevealPhase('idle');
      setLastResults([]);
      setRevealPayload(null);
      setEliminatedIds([]);
      setSettled(false);
    });

    socket.on('showQrCode', (url: string) => setQrCodeUrl(url));
    socket.on('hideQrCode', () => setQrCodeUrl(null));

    return () => { socket.close(); };
  }, []);

  const offlineBadge = !connected ? (
    <div className="display-offline" role="status">サーバー切断中 — 再接続しています</div>
  ) : null;

  const currentQuiz = gameState?.quizzes[gameState.currentQuizIndex];
  const sortedTeams = gameState?.teams.slice().sort((a, b) => b.points - a.points) || [];
  const quizVisible = !!currentQuiz && currentQuiz.status !== 'waiting';
  // 回答受付中は問題に集中させたいのでランキングを出さない。
  // 順位を見せるのは待機中と結果発表後（逆転を味わう場面）だけにする。
  const rankingVisible = !currentQuiz || currentQuiz.status !== 'answering';
  // チーム数に応じてランキング行を詰める（1080pの縦に収めるため）
  const rankDensity = sortedTeams.length > 14 ? 'ultra' : sortedTeams.length > 9 ? 'compact' : '';

  // 最終結果発表は他のどの画面よりも優先する。
  // 直前の問題の開示・配分画面が残っていると、その下に隠れて表示されなかったため
  if (gameState?.finalReveal) {
    return (
      <div className="display-container final-stage-screen">{offlineBadge}
        <FinalRevealBoard state={gameState.finalReveal} />
      </div>
    );
  }

  // 回答開示 / 答え合わせ
  // リロードで復帰した場合もstatusから開示状態に入れるようにする
  const showDisclosure =
    !!currentQuiz &&
    gameState &&
    ((revealPhase === 'disclosure' && currentQuiz.status === 'closed') ||
      (revealPhase === 'verdict') ||
      (revealPhase === 'idle' && currentQuiz.status === 'closed'));

  if (showDisclosure && currentQuiz && gameState) {
    return (
      <div className="display-container">{offlineBadge}
        <DisclosureBoard
          quiz={currentQuiz}
          gameState={gameState}
          correctOptionId={revealPayload?.correctOptionId ?? currentQuiz.correctOptionId}
          eliminatedIds={eliminatedIds}
          /*
           * リロードで復帰した場合のみ演出を省いて確定状態で見せる。
           * 演出中(verdictRunning)は status が revealed になっても確定させない
           * — でないと gameState が先に届いた時点で正解の色が出てしまう。
           */
          settled={settled || (!verdictRunning && revealPhase !== 'verdict' && currentQuiz.status === 'revealed')}
        />
      </div>
    );
  }

  // 分配と順位変動
  if (revealPhase === 'payout' && lastResults.length > 0 && revealPayload) {
    return (
      <div className="display-container">{offlineBadge}
        <PayoutBoard
          payload={revealPayload}
          results={lastResults}
          hidePoints={!!gameState?.rankingHidden}
        />
      </div>
    );
  }

  // 最終問題の予告
  if (finalPreviewQuizId && currentQuiz?.id === finalPreviewQuizId) {
    return (
      <div className="display-container final-announce">{offlineBadge}
        <div className="announce-content">
          <p className="announce-title">FINAL</p>
          <p className="announce-sub">最終問題　配分総額 {currentQuiz.prizePool.toLocaleString()} pt</p>
        </div>
      </div>
    );
  }

  // メイン画面
  return (
    <div className="display-container">{offlineBadge}
      <h1 className="display-title">
        <img src="/logo-stacked.png" alt="CELIAR GAME" className="logo-stacked" />
      </h1>

      {qrCodeUrl && (
        <div className="qr-display">
          <div className="qr-container">
            <QRCodeSVG value={qrCodeUrl} size={440} bgColor="#ffffff" fgColor="#000000" />
          </div>
          <p className="qr-url">{qrCodeUrl}</p>
          <p className="qr-instruction">QRコードを読み取って参加</p>
        </div>
      )}

      {/* 回答受付中はクイズを全幅で見せる。ランキングを併記するのはそれ以外の場面だけ */}
      <div className={`display-main ${quizVisible && rankingVisible ? 'display-main-split' : ''}`}>
        {/* 現在のクイズ */}
        {quizVisible && currentQuiz && (
          <div className="current-quiz-display">
            <div className="quiz-meta-row">
              <div className={`quiz-status-badge is-${currentQuiz.status}`}>
                {currentQuiz.status === 'answering' && '回答受付中'}
                {currentQuiz.status === 'closed' && '締め切り'}
                {currentQuiz.status === 'revealed' && '結果発表済み'}
              </div>
              <div className="quiz-prize-badge">
                配分総額 {currentQuiz.prizePool.toLocaleString()} pt
              </div>
            </div>

            <p className="quiz-question-display">{currentQuiz.question}</p>

            <div className="options-display">
              {currentQuiz.options.map((opt, i) => {
                const isCorrect = currentQuiz.status === 'revealed' && currentQuiz.correctOptionId === opt.id;
                return (
                  <div key={opt.id} className={`option-display ${isCorrect ? 'correct' : ''}`}>
                    <span className="option-key">{String.fromCharCode(65 + i)}</span>
                    <span>{opt.text}</span>
                  </div>
                );
              })}
            </div>

            {/* 回答受付中は「何チームが回答済みか」だけ見せる（選択内容は伏せる） */}
            {currentQuiz.status === 'answering' && gameState && (() => {
              const answeredIds = new Set(
                gameState.answers.filter((a) => a.quizId === currentQuiz.id).map((a) => a.teamId)
              );
              return (
                <>
                  <p className="answered-count">
                    回答済み {answeredIds.size} / {gameState.teams.length}
                  </p>
                  {/* 回答済みのチーム名を点灯させる（選んだ内容は伏せたまま） */}
                  <div className="answered-teams">
                    {gameState.teams.map((t) => (
                      <span key={t.id} className={`answered-team-chip ${answeredIds.has(t.id) ? 'is-answered' : ''}`}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ランキング（回答受付中は非表示） */}
        {rankingVisible && (
        <div className={`ranking-display ${rankDensity ? `rank-${rankDensity}` : ''}`}>
          <h2>ランキング</h2>
          {gameState?.rankingHidden ? (
            <MaskedRanking teamCount={gameState.teams.length} />
          ) : (
            <div className="ranking-list">
              {calcRankedTeams(sortedTeams).map((team) => (
                <div key={team.id} className={`ranking-row ${team.rank <= 3 ? `top-${team.rank}` : ''}`}>
                  <span className="rank-number">{team.rank}</span>
                  <span className="team-name">{team.name}</span>
                  <span className="points-amount">{team.points.toLocaleString()} pt</span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

export default DisplayPage;
