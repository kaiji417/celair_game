import { useState, useEffect } from 'react';
import { usePlayerSocket, currentFinalStage, isVoteHidden } from '../hooks/useSocket';
import type { AnswerResult, RevealAnswerResult, SubmitResult } from '../hooks/useSocket';
import { useWakeLock } from '../lib/useWakeLock';
import { formatSlotNumber } from '../lib/teamSlot';
import { useCountUp } from '../lib/useCountUp';
import { calcRankMovement } from '../lib/ranking';

// 回答送信に失敗したときの文言。何が起きたか・どうすればいいかを1文で伝える
const SUBMIT_ERROR_MESSAGES: Record<Exclude<SubmitResult, 'ok'>, string> = {
  offline: '電波が不安定で送れませんでした。もう一度「回答する」を押してください',
  closed: '回答はすでに締め切られました',
  noTeam: 'チームの情報が見つかりません。画面を再読み込みしてください',
  rejected: '送れませんでした。もう一度「回答する」を押してください',
};

function PlayerPage() {
  const { connected, sessionReady, gameState, team, joinTeam, leaveTeam, submitAnswer, lastResult, lastReveal, clearResult, frozenPoints, myAnswerDetail } = usePlayerSocket();
  const finalStage = currentFinalStage(gameState);
  const [teamName, setTeamName] = useState('');
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const displayPoints = frozenPoints !== null ? frozenPoints : (team?.points ?? 0);
  // ランキング非表示中は自チームの得点も伏せる（サーバーからも 0 で届く）
  const pointsLabel = gameState?.rankingHidden ? '?' : displayPoints.toLocaleString();

  // チーム参加後はゲーム終了まで画面を点けたままにする（スリープによる切断を防ぐ）
  useWakeLock(!!team && finalStage?.kind !== 'ranking');

  useEffect(() => {
    const timeout = setTimeout(() => setIsRestoring(false), 5000);
    return () => clearTimeout(timeout);
  }, []);

  // 保存済みチームへの復帰はフック側（接続のたび）で行う。ここでは完了を待つだけ
  useEffect(() => {
    if (sessionReady) setIsRestoring(false);
  }, [sessionReady]);

  const joinErrorMessage = (reason: 'taken' | 'closed' | 'invalid') =>
    reason === 'taken'
      ? 'このチームは別の端末で参加中です（1チーム1台）。端末を替える場合は運営に声をかけてください'
      : reason === 'closed'
        ? 'ゲーム開始後は新しいチームを作れません。運営に声をかけてください'
        : 'このチーム名では参加できません';

  const handleJoin = async (name: string) => {
    if (!name.trim()) { setError('チーム名を入力してください'); return; }
    const result = await joinTeam(name.trim());
    if (result.ok) { setError(''); setSelectedSlot(null); }
    else { setError(joinErrorMessage(result.reason)); setSelectedSlot(null); }
  };

  const currentQuiz = gameState?.quizzes[gameState.currentQuizIndex];

  // クイズが変わったら入力状態をリセット、差し戻し検知も兼ねる
  useEffect(() => {
    if (currentQuiz?.status === 'answering' && team) {
      const myAnswer = gameState?.answers.find((a) => a.teamId === team.id && a.quizId === currentQuiz.id);
      if (myAnswer) {
        setHasAnswered(true);
        // 送信済みの選択肢を選択状態として復元する（再訪時に選択が空にならないように）
        setSelectedOptionId((prev) => {
          if (prev) return prev;
          const saved = myAnswerDetail?.quizId === currentQuiz.id ? myAnswerDetail.optionId : null;
          return saved ?? null;
        });
      } else {
        setHasAnswered(false);
        setSelectedOptionId(null);
      }
    }
  }, [currentQuiz?.id, currentQuiz?.status, team, gameState?.answers, myAnswerDetail]);

  // 送信済みと同じ選択肢なら送信ボタンを無効にする
  const isSameAsSubmitted =
    hasAnswered &&
    myAnswerDetail?.quizId === currentQuiz?.id &&
    myAnswerDetail?.optionId === selectedOptionId;

  // 結果通知は自動では閉じない（目を離している間に消えると結果を見逃すため）。
  // 次の設問が始まったら自動で閉じる。
  useEffect(() => {
    if (lastResult && currentQuiz?.status === 'answering') clearResult();
  }, [lastResult, currentQuiz?.status, clearResult]);

  const handleSubmit = async () => {
    if (!currentQuiz || !team) return;
    setError('');
    if (!selectedOptionId) { setError('選択肢を選んでください'); return; }

    const result = await submitAnswer(selectedOptionId);
    if (result === 'ok') {
      setHasAnswered(true);
    } else {
      setError(SUBMIT_ERROR_MESSAGES[result]);
    }
  };

  if (isRestoring) {
    return <div className="container"><div className="waiting"><p className="waiting-text">接続中...</p></div></div>;
  }

  // 切断に気づかず「回答したつもり」になるのを防ぐ。全画面共通で最上部に出す
  const connectionBanner = !connected ? (
    <div className="offline-banner" role="status">電波が切れています。つながり直すまでお待ちください</div>
  ) : null;

  if (!team) {
    const slots = gameState?.teamSlots ?? [];
    return (
      <div className="container">
        {connectionBanner}
        <img src="/logo-horizontal.png" alt="CELIAR GAME" className="logo-header" style={{ marginTop: '28px' }} />
        <h1 className="title" style={{ fontSize: '1.4rem', marginBottom: '8px' }}>チーム登録</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '20px', textAlign: 'center' }}>
          {selectedSlot ? '選択中 — 下のボタンで確定' : 'あなたのチームを選んでください'}
        </p>
        {slots.length > 0 ? (
          <>
            <div className="team-slot-grid">
              {slots.map((slot: string, i: number) => {
                // 端末が外れたチームは再参加できる（電池切れ・端末交換）
                const taken = gameState?.teams.find((t) => t.name === slot && t.hasDevice !== false);
                const isSelected = selectedSlot === slot;
                return (
                  <button
                    key={slot}
                    className={`team-slot-card ${taken ? 'team-slot-taken' : ''} ${isSelected ? 'team-slot-selected' : ''}`}
                    onClick={() => !taken && setSelectedSlot(isSelected ? null : slot)}
                    disabled={!!taken}
                  >
                    <div className="team-slot-label">{formatSlotNumber(i)}</div>
                    <div className="team-slot-name">{slot}</div>
                    {taken && <div className="team-slot-taken-badge">参加済み</div>}
                    {isSelected && <div className="team-slot-selected-badge">✓</div>}
                  </button>
                );
              })}
            </div>
            {selectedSlot && (
              <button
                className="btn btn-gold btn-block player-sticky-action"
                style={{ marginTop: '8px' }}
                onClick={() => handleJoin(selectedSlot)}
              >
                参加する
              </button>
            )}
          </>
        ) : (
          <div className="card">
            <input
              type="text"
              placeholder="チーム名を入力"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin(teamName)}
              maxLength={30}
            />
            <button className="btn btn-primary btn-block" onClick={() => handleJoin(teamName)} style={{ marginTop: '16px' }}>参加する</button>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '16px', textAlign: 'center', lineHeight: 1.6 }}>
              ※1チームにつき参加できる端末は1台です
            </p>
          </div>
        )}
        {error && <p style={{ color: 'var(--red-bright)', marginTop: '12px', textAlign: 'center' }}>{error}</p>}
      </div>
    );
  }

  if (lastResult) {
    return (
      <ResultSheet
        result={lastResult}
        reveal={lastReveal}
        rankingHidden={!!gameState?.rankingHidden}
        onClose={clearResult}
      />
    );
  }

  // 最終結果発表中。自分の順位は会場のディスプレイで出た後に手元にも出す
  if (finalStage && team && finalStage.kind !== 'ranking') {
    const fr = gameState!.finalReveal!;
    const announced = fr.stages
      .slice(0, fr.step + 1)
      .filter((s) => s.kind === 'lower' || s.kind === 'podium' || s.kind === 'champion')
      .flatMap((s) => s.teams);
    const mine = announced.find((t) => t.id === team.id);
    const heroClass = mine ? (mine.rank === 1 ? 'hero-champion' : mine.rank <= 3 ? 'hero-top3' : '') : '';
    return (
      <div className="container player-final">
        <div className={`player-final-hero ${heroClass}`}>
          <p className="player-final-label">{team.name}</p>
          {mine ? (
            <>
              {mine.rank === 1 ? (
                <p className="player-final-rank player-final-word">優勝</p>
              ) : (
                <p className="player-final-rank">{mine.rank}<span className="player-final-rank-unit">位</span></p>
              )}
              <div className="points-display" style={{ marginTop: '12px' }}>
                <div className="points-label">最終ポイント</div>
                <div className="points-amount">{mine.points.toLocaleString()}<span className="points-unit"> pt</span></div>
              </div>
            </>
          ) : (
            <p className="waiting-text" style={{ marginTop: '12px' }}>最終結果を発表中です。会場の画面をご覧ください</p>
          )}
        </div>
      </div>
    );
  }

  // 最終結果（全順位の発表後）
  if (finalStage?.kind === 'ranking' && team) {
    const rankedTeams = finalStage.teams;
    const myRank = rankedTeams.find((t) => t.id === team.id)?.rank ?? 0;
    const isChampion = myRank === 1;

    return (
      <div className="container player-final">
        <div className={`player-final-hero ${isChampion ? 'hero-champion' : myRank <= 3 ? 'hero-top3' : ''}`}>
          <p className="player-final-label">{team.name}</p>
          {isChampion ? (
            <p className="player-final-rank player-final-word">優勝</p>
          ) : (
            <p className="player-final-rank">
              {myRank}
              <span className="player-final-rank-unit">位</span>
            </p>
          )}
          <div className="points-display" style={{ marginTop: '12px' }}>
            <div className="points-label">最終ポイント</div>
            <div className="points-amount">
              {(rankedTeams.find((t) => t.id === team.id)?.points ?? 0).toLocaleString()}
              <span className="points-unit"> pt</span>
            </div>
          </div>
        </div>

        <div className="ranking mt-20">
          <h3 style={{ color: 'var(--accent)', marginBottom: '10px', letterSpacing: '0.1em' }}>最終ランキング</h3>
          {rankedTeams.map((t) => (
            <div key={t.id} className={`ranking-item ${t.rank <= 3 ? 'top-3' : ''} ${t.id === team.id ? 'selected' : ''}`}>
              <span className={`rank rank-${Math.min(t.rank, 4)}`}>{t.rank}</span>
              <span style={{ flex: 1 }}>{t.name}</span>
              <span style={{ color: 'var(--accent)' }}>{t.points.toLocaleString()} pt</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 待機中 or 結果発表済み
  if (!currentQuiz || currentQuiz.status === 'waiting' || currentQuiz.status === 'revealed') {
    return (
      <div className="container">
        {connectionBanner}
        <p className="player-team-name">{team.name}</p>
        <div className="points-display">
          <div className="points-label">獲得ポイント</div>
          <div className="points-amount">{pointsLabel}<span className="points-unit"> pt</span></div>
        </div>
        <div className="waiting"><p className="waiting-text">次の問題をお待ちください</p></div>
        {gameState && !gameState.rankingHidden && <Ranking teams={gameState.teams} myTeamId={team.id} />}
        {gameState?.rankingHidden && (
          <div className="ranking-masked mt-20">
            <div className="ranking-masked-rows" aria-hidden="true">
              {Array.from({ length: Math.max(gameState.teams.length, 4) }, (_, i) => (
                <div key={i} className="ranking-masked-row">
                  <span className="masked-block masked-rank" />
                  <span className="masked-block masked-name" style={{ width: `${40 + ((i * 19) % 32)}%` }} />
                  <span className="masked-block masked-points" style={{ width: `${40 + ((i * 13) % 24)}px` }} />
                </div>
              ))}
            </div>
            <div className="ranking-masked-overlay">
              <p className="ranking-masked-text">最終結果をお楽しみに</p>
              <p className="ranking-masked-sub">順位と得点は最後に発表します</p>
            </div>
          </div>
        )}
        {gameState?.phase === 'lobby' && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: '24px', fontSize: '0.85rem', padding: '10px', opacity: 0.6 }}
            onClick={() => {
              if (confirm('チームを変更しますか？')) leaveTeam();
            }}
          >
            チームを変更する
          </button>
        )}
      </div>
    );
  }
  if (currentQuiz.status === 'closed') {
    return (
      <div className="container">
        {connectionBanner}
        <p className="player-team-name">{team.name}</p>
        <div className="points-display">
          <div className="points-label">獲得ポイント</div>
          <div className="points-amount">{pointsLabel}<span className="points-unit"> pt</span></div>
        </div>
        <div className="card">
          <p className="question-text">{currentQuiz.question}</p>
          {/* 発表を待つ間、自分が何を選んだかを見られるようにする */}
          {(() => {
            const myOptionId = myAnswerDetail?.quizId === currentQuiz.id
              ? myAnswerDetail.optionId
              : gameState?.answers.find((a) => a.teamId === team.id && a.quizId === currentQuiz.id)?.optionId;
            const myText = currentQuiz.options.find((o) => o.id === myOptionId)?.text;
            return (
              <div className={`my-answer-box ${myText ? '' : 'is-empty'}`}>
                <p className="my-answer-label">あなたの回答</p>
                <p className="my-answer-text">{myText ?? '回答なし'}</p>
              </div>
            );
          })()}
          {/* 回答の割れ方（会場の画面を見ていない人にも緊張感を）。最終問題・非表示中は伏せる */}
          {gameState && !isVoteHidden(gameState, currentQuiz) && (() => {
            const quizAnswers = gameState.answers.filter((a) => a.quizId === currentQuiz.id);
            const total = gameState.teams.length;
            return (
              <div className="answer-split">
                {currentQuiz.options.map((o) => {
                  const n = quizAnswers.filter((a) => a.optionId === o.id).length;
                  return (
                    <div key={o.id} className="answer-split-row">
                      <span className="answer-split-label">{o.text}</span>
                      <span className="answer-split-bar">
                        <span style={{ width: total > 0 ? `${(n / total) * 100}%` : 0 }} />
                      </span>
                      <span className="answer-split-count">{n}チーム</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="waiting"><p className="waiting-text">締め切りました。正解発表をお待ちください</p></div>
        </div>
      </div>
    );
  }

  // 回答画面
  return (
    <div className="container">
      {connectionBanner}
      <p className="player-team-name">{team.name}</p>
      <div className="points-display">
        <div className="points-label">獲得ポイント</div>
        <div className="points-amount">{pointsLabel}<span className="points-unit"> pt</span></div>
      </div>

      <div className="card">
        <p className="question-text">{currentQuiz.question}</p>

        {/* このラウンドの配分総額（正解すれば山分けで獲得） */}
        <div className="prize-pool-display" style={{ marginBottom: '16px' }}>
          <span>{currentQuiz.prizePool.toLocaleString()} pt</span>
          <small>正解したチームで山分け</small>
        </div>

        {/* 回答後も締め切りまでは選び直せる */}
        <div>
          {currentQuiz.options.map((option, i) => {
            const isSubmitted = hasAnswered && myAnswerDetail?.quizId === currentQuiz.id && myAnswerDetail.optionId === option.id;
            const isPicked = selectedOptionId === option.id;
            return (
              <button
                key={option.id}
                className={`option-btn ${isPicked ? 'selected' : ''} ${isSubmitted ? 'submitted' : ''}`}
                onClick={() => setSelectedOptionId(option.id)}
                aria-pressed={isPicked}
              >
                <span className="option-key">{String.fromCharCode(65 + i)}</span>
                <span className="option-text">{option.text}</span>
                {isSubmitted && <span className="option-submitted-mark">選択中</span>}
              </button>
            );
          })}
        </div>

        {error && <p style={{ color: 'var(--red-bright)', marginTop: '10px' }}>{error}</p>}

        {hasAnswered && (
          <p className="answer-hint">締め切りまで変更できます</p>
        )}

        <button
          className="btn btn-gold btn-block mt-20 player-sticky-action"
          onClick={handleSubmit}
          disabled={!selectedOptionId || !connected || isSameAsSubmitted}
        >
          {!connected ? '接続が切れています' : hasAnswered ? (isSameAsSubmitted ? '回答済み' : 'この選択に変更する') : '回答する'}
        </button>
      </div>
    </div>
  );
}

/**
 * 結果通知。
 * 「当たったか」だけでなく「正解は何で、自分は何を選び、何チームで分けたか」まで
 * 1枚で分かるようにする。得点は前の値から積み上がる動きで見せる。
 */
function ResultSheet({
  result,
  reveal,
  rankingHidden,
  onClose,
}: {
  result: AnswerResult;
  reveal: { payload: RevealAnswerResult; correctText: string; myOptionText: string | null } | null;
  rankingHidden: boolean;
  onClose: () => void;
}) {
  const prevPoints = result.newPoints - result.received;
  const shownPoints = useCountUp(result.newPoints, { from: prevPoints, duration: 1200, delay: 450 });
  const shownDelta = useCountUp(result.received, { from: 0, duration: 900, delay: 250 });

  const payload = reveal?.payload;
  const hidden = rankingHidden || !!payload?.hidden;
  const movement = reveal && !hidden ? calcRankMovement(reveal.payload.results).get(result.teamId) : undefined;
  const answered = !!result.optionId;

  // 表示中は背面のページをスクロールさせない（iOS で表示位置がずれる原因）
  useEffect(() => {
    window.scrollTo(0, 0);
    document.body.classList.add('is-sheet-open');
    return () => document.body.classList.remove('is-sheet-open');
  }, []);

  return (
    <div
      className={`result-sheet-backdrop ${result.won ? 'is-win' : 'is-lose'}`}
      onClick={onClose}
      role="dialog"
      aria-live="assertive"
      aria-label={result.won ? (hidden ? '正解' : `正解。${result.received}ポイント獲得`) : answered ? '不正解' : '無回答'}
    >
      <div className="result-sheet" onClick={(e) => e.stopPropagation()}>
        <p className={`result-verdict ${result.won ? 'is-win' : 'is-lose'}`}>
          {result.won ? '正解' : answered ? '不正解' : '無回答'}
        </p>

        {/* 正解と自分の回答。外れた時ほど「何が正解だったか」を知りたい */}
        {reveal && (
          <dl className="result-answers">
            <div className="result-answer-row is-correct">
              <dt>正解</dt>
              <dd>{reveal.correctText}</dd>
            </div>
            {!result.won && (
              <div className="result-answer-row is-mine">
                <dt>あなた</dt>
                <dd>{reveal.myOptionText ?? '回答なし'}</dd>
              </div>
            )}
          </dl>
        )}

        {/* 何チームが正解したか。少数正解ほど取り分が大きい、というルールがここで実感できる。
            非表示中は正解チーム数・獲得額とも伏せる（サーバーからも届かない） */}
        {payload && !hidden && !payload.noWinner && (
          <div className="result-split">
            <span>正解 <span className="result-split-count">{payload.winnerCount}チーム</span></span>
            {payload.winnerCount === 1 && <span className="result-split-tag">総取り</span>}
          </div>
        )}

        {result.won && !hidden && (
          <p className="result-gain">
            +{shownDelta.toLocaleString()}<span className="result-gain-unit"> pt</span>
          </p>
        )}

        {/* 非公開中は合計・順位を出さない（他チームとの差が推測できてしまうため） */}
        {!hidden ? (
          <div className="result-total">
            <div className="result-total-main">
              <span className="result-total-label">合計</span>
              <span className="result-total-value">
                {shownPoints.toLocaleString()}<span className="points-unit"> pt</span>
              </span>
            </div>
            {movement && (
              <div className="result-rank">
                <span className="result-rank-label">順位</span>
                <span className="result-rank-value">{movement.newRank}位</span>
                {movement.delta !== 0 && (
                  <span className={`result-rank-move ${movement.delta > 0 ? 'is-up' : 'is-down'}`}>
                    {movement.delta > 0 ? `▲${movement.delta}` : `▼${-movement.delta}`}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="result-total">
            <div className="result-total-main">
              <span className="result-total-label">合計</span>
              <span className="result-total-value">?<span className="points-unit"> pt</span></span>
            </div>
            <div className="result-rank">
              <span className="result-rank-label">順位</span>
              <span className="result-rank-value">?位</span>
            </div>
          </div>
        )}

        <button className="btn btn-secondary btn-block result-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

function Ranking({ teams, myTeamId }: { teams: { id: string; name: string; points: number }[]; myTeamId: string }) {
  const sorted = [...teams].sort((a, b) => b.points - a.points);

  const rankedTeams: { id: string; name: string; points: number; rank: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      rankedTeams.push({ ...sorted[i], rank: 1 });
    } else {
      const prev = sorted[i - 1];
      const prevRank = rankedTeams[i - 1].rank;
      rankedTeams.push({ ...sorted[i], rank: sorted[i].points === prev.points ? prevRank : i + 1 });
    }
  }

  return (
    <div className="ranking mt-20">
      <h3 style={{ marginBottom: '10px' }}>ランキング</h3>
      {rankedTeams.map((team) => (
        <div key={team.id} className={`ranking-item ${team.rank <= 3 ? 'top-3' : ''} ${team.id === myTeamId ? 'selected' : ''}`}>
          <span className={`rank rank-${Math.min(team.rank, 4)}`}>{team.rank}</span>
          <span style={{ flex: 1 }}>{team.name}</span>
          <span style={{ color: 'var(--accent)' }}>{team.points.toLocaleString()} pt</span>
        </div>
      ))}
    </div>
  );
}

export default PlayerPage;
