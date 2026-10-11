import { useState, useEffect } from 'react';
import { useAdminSocket, Quiz, QuizOption } from '../hooks/useSocket';
import { formatSlotNumber } from '../lib/teamSlot';
import { v4 as uuidv4 } from 'uuid';

function AdminPage() {
  const {
    gameState, authenticated, authError, connect, connected, adminError, clearAdminError,
    updateQuizzes, startQuiz, closeAnswers, revealAnswer,
    resetGame, fullReset, removeTeam, releaseDevice, showQrCode, hideQrCode, finalRevealNext,
    adjustPoints, resetAnswer, setTeamSlots, showResults,
  } = useAdminSocket();
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrShowing, setQrShowing] = useState(false);
  const [password, setPassword] = useState('');
  const [adjustTeamId, setAdjustTeamId] = useState('');
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [editingSlots, setEditingSlots] = useState(false);
  const [slotsInput, setSlotsInput] = useState<string[]>([]);
  // 正解発表後の進行段階（ディスプレイ側の表示状態はサーバーが持たないので管理画面で追う）
  const [resultStep, setResultStep] = useState<'revealed' | 'shown'>('revealed');
  const currentQuizId = gameState?.quizzes[gameState.currentQuizIndex]?.id;
  useEffect(() => { setResultStep('revealed'); }, [currentQuizId]);

  // 参加者用URLはサーバーに解決させる（会場でIPを手入力させない）
  useEffect(() => {
    if (!authenticated || qrUrl) return;
    fetch('/api/player-url')
      .then((r) => r.json())
      .then((d: { url: string | null }) => { if (d.url) setQrUrl(d.url); })
      .catch(() => { /* 取得失敗時は手入力にフォールバック */ });
  }, [authenticated, qrUrl]);

  if (!authenticated) {
    return (
      <div className="container container-center" style={{ maxWidth: '400px' }}>
        <img src="/logo-horizontal.png" alt="CELIAR GAME" className="logo-header" />
        <h1 className="title" style={{ fontSize: '1.4rem', marginBottom: '32px' }}>管理者</h1>
        <div className="card" style={{ width: '100%' }}>
          <input
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect(password)}
          />
          {authError && <p style={{ color: 'var(--red-bright)', marginTop: '8px' }}>{authError}</p>}
          <button className="btn btn-primary btn-block" style={{ marginTop: '16px' }} onClick={() => connect(password)}>ログイン</button>
        </div>
      </div>
    );
  }

  const currentQuiz = gameState?.quizzes[gameState.currentQuizIndex];

  const handleAddQuiz = () => {
    const newQuiz: Quiz = {
      id: uuidv4(),
      question: '',
      options: [
        { id: uuidv4(), text: '' },
        { id: uuidv4(), text: '' },
      ],
      prizePool: 1000,
      status: 'waiting',
    };
    setEditingQuiz(newQuiz);
  };

  const handleSaveQuiz = () => {
    if (!editingQuiz || !gameState) return;
    if (!editingQuiz.question.trim()) {
      alert('問題文を入力してください');
      return;
    }
    if (editingQuiz.prizePool <= 0) {
      alert('配分総額は1以上にしてください');
      return;
    }
    if (editingQuiz.options.length < 2) {
      alert('選択肢は2つ以上にしてください');
      return;
    }
    if (editingQuiz.options.some((o) => !o.text.trim())) {
      alert('空の選択肢があります。すべて入力するか、不要な選択肢を削除してください');
      return;
    }
    if (!editingQuiz.options.some((o) => o.id === editingQuiz.correctOptionId)) {
      alert('正解の選択肢を選んでください（選択肢の左の「正解」をタップ）');
      return;
    }
    const quizzes = [...gameState.quizzes];
    const index = quizzes.findIndex((q) => q.id === editingQuiz.id);
    if (index >= 0) {
      quizzes[index] = editingQuiz;
    } else {
      quizzes.push(editingQuiz);
    }
    updateQuizzes(quizzes);
    setEditingQuiz(null);
  };

  const handleDeleteQuiz = (quizId: string) => {
    if (!gameState) return;
    updateQuizzes(gameState.quizzes.filter((q) => q.id !== quizId));
  };

  const handleOptionChange = (optionId: string, value: string) => {
    if (!editingQuiz) return;
    setEditingQuiz({
      ...editingQuiz,
      options: editingQuiz.options.map((opt) =>
        opt.id === optionId ? { ...opt, text: value } : opt
      ),
    });
  };

  const handleAddOption = () => {
    if (!editingQuiz) return;
    const newOption: QuizOption = { id: uuidv4(), text: '' };
    setEditingQuiz({ ...editingQuiz, options: [...editingQuiz.options, newOption] });
  };

  const handleRemoveOption = (optionId: string) => {
    if (!editingQuiz) return;
    setEditingQuiz({
      ...editingQuiz,
      options: editingQuiz.options.filter((o) => o.id !== optionId),
      // 正解にしていた選択肢を消したら、正解も未設定に戻す
      correctOptionId: editingQuiz.correctOptionId === optionId ? undefined : editingQuiz.correctOptionId,
    });
  };

  const correctTextOf = (q: Quiz) => q.options.find((o) => o.id === q.correctOptionId)?.text;

  // 正解は作成時に登録したものを使う。本番中に選び間違える事故を防ぐため、ここでは選ばせない
  const handleReveal = () => {
    if (!currentQuiz) return;
    if (!confirm('正解発表を始めます。\nこの操作は取り消せません。よろしいですか？')) return;
    clearAdminError();
    revealAnswer({});
  };

  const handleFinalReveal = () => {
    if (finalRevealBlocker) return;
    if (!confirm('最終結果発表を始めますか？\n始めると、これ以上問題は出題できません。\n以降は「次へ」ボタンで1段ずつ進めます。')) return;
    finalRevealNext();
  };

  // 出題は「次の問題へ」と一覧の「開始」のどちらからでも同じ確認を挟む
  const confirmStartQuiz = (index: number) => {
    const quiz = gameState?.quizzes[index];
    if (!quiz) return;
    if (!confirm(`Q${index + 1}「${quiz.question}」を開始しますか？\n参加者のスマホに問題が表示されます。`)) return;
    clearAdminError();
    startQuiz(index);
  };

  const currentAnswers = gameState?.answers.filter((a) => a.quizId === currentQuiz?.id) ?? [];
  const canResetAnswer = !!currentQuiz && currentQuiz.status === 'answering';
  // 次に出題できる未出題クイズ（進行中に一覧を探さないための導線に使う）
  const nextQuizIndex = gameState?.quizzes.findIndex((q) => q.status === 'waiting') ?? -1;
  const answeredCount = currentAnswers.length;
  const totalTeams = gameState?.teams.length ?? 0;
  const unansweredTeams = gameState?.teams.filter((t) => !currentAnswers.some((a) => a.teamId === t.id)) ?? [];

  // 最終結果発表の進行
  const fr = gameState?.finalReveal ?? null;
  const frStage = fr ? fr.stages[fr.step] : null;
  const frNext = fr ? fr.stages[fr.step + 1] ?? null : null;
  const stageLabel = (s: { kind: string; rank?: number }) =>
    s.kind === 'intro' ? 'タイトル'
      : s.kind === 'lower' ? '4位以下'
        : s.kind === 'podium' ? `${s.rank}位`
          : s.kind === 'champion' ? '優勝'
            : '全順位';

  // 最終結果発表を押せない理由（nullなら押せる）。条件を満たすまでボタンを無効にして理由を横に出す
  const finalRevealBlocker = (() => {
    if (!gameState) return '読み込み中';
    if (fr) return null;
    if (!gameState.quizzes.some((q) => q.status === 'revealed')) return 'まだ1問も正解発表していません';
    if (currentQuiz && (currentQuiz.status === 'answering' || currentQuiz.status === 'closed')) {
      return `Q${gameState.currentQuizIndex + 1} の正解発表がまだです`;
    }
    if (!gameState.quizzes.some((q) => q.isLastQuiz)) return 'クイズ一覧で「最終問題」にチェックした問題がありません';
    if (!gameState.quizzes.some((q) => q.isLastQuiz && q.status === 'revealed')) return '最終問題の正解発表がまだです';
    return null;
  })();

  return (
    <div className="container admin-container" style={{ maxWidth: '1200px' }}>
      {!connected && <div className="offline-banner">サーバーとの接続が切れています — 再接続中</div>}
      <h1 className="title">管理者画面</h1>
      {adminError && (
        <div className="card" role="alert" style={{ borderColor: 'var(--red-bright)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ flex: 1, color: 'var(--red-bright)' }}>{adminError}</span>
          <button className="btn btn-secondary" style={{ padding: '4px 12px' }} onClick={clearAdminError}>閉じる</button>
        </div>
      )}

      {/* QRコード */}
      <div className="card">
        <h3>QRコード表示</h3>
        <div className="flex-row mt-20" style={{ flexWrap: 'wrap' }}>
          <input
            type="text"
            value={qrUrl}
            onChange={(e) => setQrUrl(e.target.value)}
            placeholder="例: http://192.168.1.10:3001/player"
            style={{ flex: '1 1 240px', minWidth: 0 }}
          />
          {!qrShowing ? (
            <button
              className="btn btn-gold"
              style={{ padding: '10px 20px', whiteSpace: 'nowrap' }}
              onClick={() => { if (qrUrl.trim()) { showQrCode(qrUrl.trim()); setQrShowing(true); } }}
              disabled={!qrUrl.trim()}
            >
              ディスプレイに表示
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ padding: '10px 20px', whiteSpace: 'nowrap' }}
              onClick={() => { hideQrCode(); setQrShowing(false); }}
            >
              非表示にする
            </button>
          )}
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginTop: '10px' }}>
          ※参加者がスマホでアクセスするURLを入力してください
        </p>
      </div>

      {/* 現在のクイズ */}
      {currentQuiz && (
        <div className="card">
          <h3>現在のクイズ: Q{gameState!.currentQuizIndex + 1}</h3>
          <p className="question-text">{currentQuiz.question}</p>
          <p>配分総額: <strong>{currentQuiz.prizePool.toLocaleString()} pt</strong>（正解チームで山分け）</p>
          <p style={{ marginTop: '6px' }}>
            ステータス:
            <span className={`status-badge status-${currentQuiz.status}`} style={{ marginLeft: '10px' }}>
              {currentQuiz.status === 'waiting' ? '待機中' : currentQuiz.status === 'answering' ? '回答受付中' : currentQuiz.status === 'closed' ? '締め切り' : '結果発表済み'}
            </span>
          </p>

          <div className="mt-20">
            {currentQuiz.status === 'answering' && (
              <div>
                {/* 全員揃ったかを締め切り判断の材料として大きく出す */}
                <div className={`answer-progress ${answeredCount === totalTeams && totalTeams > 0 ? 'is-complete' : ''}`}>
                  <span className="answer-progress-count">{answeredCount} / {totalTeams}</span>
                  <span className="answer-progress-label">
                    {totalTeams > 0 && answeredCount === totalTeams ? '全チーム回答済み' : '回答待ち'}
                  </span>
                </div>
                {/* 誰を待っているかを名指しで出す（司会が声をかけられるように） */}
                {unansweredTeams.length > 0 && (
                  <div style={{ margin: '0 0 16px' }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '6px' }}>
                      未回答（{unansweredTeams.length}チーム）
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {unansweredTeams.map((t) => (
                        <span
                          key={t.id}
                          className="status-badge"
                          style={{ fontSize: '0.95rem', padding: '4px 10px' }}
                          title={t.hasDevice === false ? '端末未接続' : undefined}
                        >
                          {t.name}{t.hasDevice === false ? '（端末なし）' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <button className="btn btn-gold btn-next-action" onClick={closeAnswers}>回答締め切り</button>
                <p className="next-action-hint">締め切ると、ディスプレイに各チームの回答が表示されます</p>
              </div>
            )}

            {currentQuiz.status === 'closed' && (
              <div>
                {/* 正解は作成時に登録済み。ここでは選ばせず、進行担当が確認できるよう表示だけする */}
                <p style={{ marginBottom: '12px', color: 'var(--text-dim)' }}>
                  登録済みの正解: <strong style={{ color: 'var(--win)' }}>{correctTextOf(currentQuiz) ?? '未設定'}</strong>
                </p>
                <div className="mt-20">
                  <button className="btn btn-gold btn-next-action" onClick={handleReveal}>正解発表</button>
                </div>
              </div>
            )}

            {currentQuiz.status === 'revealed' && (
              <div className="mt-20">
                <p style={{ marginBottom: '12px', color: 'var(--win)', fontWeight: 'bold' }}>正解発表済み</p>
                {/* 配分を表示 → 次の問題へ。次の問題を始めるとディスプレイの配分画面は自動で閉じる */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className={`btn ${resultStep === 'revealed' ? 'btn-gold btn-next-action' : 'btn-secondary btn-quiet'}`}
                    onClick={() => { showResults(); setResultStep('shown'); }}
                  >
                    配分を表示
                  </button>
                  {/* 一覧まで戻らずに次へ進めるようにする（進行中に探させない） */}
                  {nextQuizIndex >= 0 && (
                    <button
                      className={`btn ${resultStep === 'shown' ? 'btn-gold btn-next-action' : 'btn-secondary btn-quiet'}`}
                      onClick={() => confirmStartQuiz(nextQuizIndex)}
                    >
                      次の問題へ（Q{nextQuizIndex + 1}{gameState!.quizzes[nextQuizIndex].isLastQuiz ? '・最終問題' : ''}）
                    </button>
                  )}
                </div>
                <p className="next-action-hint">
                  {resultStep === 'revealed' && '司会が盛り上げたら「配分を表示」'}
                  {resultStep === 'shown' && (nextQuizIndex >= 0
                    ? '準備ができたら次の問題へ（配分画面は自動で閉じます）'
                    : '全問終了です。「最終結果発表を始める」へ')}
                </p>
              </div>
            )}
          </div>

          {/* 回答状況 */}
          <div className="mt-20">
            <h4>回答状況 ({currentAnswers.length}/{gameState?.teams.length})</h4>
            {gameState?.teams.map((team) => {
              const answer = currentAnswers.find((a) => a.teamId === team.id);
              return (
                <div key={team.id} className="ranking-item">
                  <span style={{ flex: 1 }}>{team.name}</span>
                  <span style={{ color: answer ? 'var(--accent)' : 'var(--text-dim)' }}>
                    {answer ? (currentQuiz.options.find((o) => o.id === answer.optionId)?.text ?? '?') : '未回答'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* クイズ一覧 */}
      <div className="card">
        <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
          <h3>クイズ一覧</h3>
          <div className="flex-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" style={{ padding: '8px 14px' }} onClick={() => { if (confirm('ポイントを初期値に戻しますか？（チームは残ります）')) resetGame(); }}>
              ゲームリセット
            </button>
            <button className="btn btn-primary" style={{ padding: '8px 14px' }} onClick={() => { if (confirm('チームも含めて完全リセットしますか？\nリハーサル後などに使用してください。')) fullReset(); }}>
              完全リセット
            </button>
            <button className="btn btn-gold" style={{ padding: '8px 14px' }} onClick={handleAddQuiz}>クイズ追加</button>
          </div>
        </div>
        <div className="quiz-list">
          {gameState?.quizzes.map((quiz, index) => (
            <div key={quiz.id} className={`quiz-item ${gameState.currentQuizIndex === index ? 'active' : ''}`}>
              <div>
                <strong>Q{index + 1}:</strong> {quiz.question || '(未設定)'}
                <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--win)' }}>
                  配分総額 {quiz.prizePool.toLocaleString()}pt
                </span>
                {quiz.isLastQuiz && <span className="status-badge status-answering" style={{ marginLeft: '8px' }}>最終問題</span>}
                <span className={`status-badge status-${quiz.status}`} style={{ marginLeft: '10px' }}>
                  {quiz.status === 'waiting' ? '待機中' : quiz.status === 'answering' ? '回答受付中' : quiz.status === 'closed' ? '締め切り' : '結果発表済み'}
                </span>
                {/* 正解の登録状況。未設定のままだと出題できない */}
                <div style={{ marginTop: '6px', fontSize: '0.85rem' }}>
                  {correctTextOf(quiz) ? (
                    <span style={{ color: 'var(--text-dim)' }}>正解: <span style={{ color: 'var(--win)' }}>{correctTextOf(quiz)}</span></span>
                  ) : (
                    <span style={{ color: 'var(--red-bright)', fontWeight: 700 }}>正解が未設定です（編集して選んでください）</span>
                  )}
                </div>
              </div>
              <div>
                {quiz.status === 'waiting' && (
                  <>
                    <button className="btn btn-gold" style={{ padding: '8px 15px', marginRight: '10px' }} onClick={() => confirmStartQuiz(index)}>開始</button>
                    <button className="btn btn-secondary" style={{ padding: '8px 15px', marginRight: '10px' }} onClick={() => setEditingQuiz(quiz)}>編集</button>
                    <button className="btn btn-secondary" style={{ padding: '8px 15px' }} onClick={() => handleDeleteQuiz(quiz.id)}>削除</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* チームスロット管理 */}
      <div className="card">
        <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <h3>チーム名リスト</h3>
          {!editingSlots ? (
            <button className="btn btn-secondary" style={{ padding: '8px 14px' }} onClick={() => {
              setSlotsInput(gameState?.teamSlots.length ? [...gameState.teamSlots] : ['']);
              setEditingSlots(true);
            }}>編集</button>
          ) : (
            <div className="flex-row" style={{ gap: '8px' }}>
              <button className="btn btn-secondary" style={{ padding: '8px 14px' }} onClick={() => setEditingSlots(false)}>キャンセル</button>
              <button className="btn btn-gold" style={{ padding: '8px 14px' }} onClick={() => {
                setTeamSlots(slotsInput.filter((s) => s.trim() !== ''));
                setEditingSlots(false);
              }}>保存</button>
            </div>
          )}
        </div>

        {editingSlots ? (
          <div>
            {slotsInput.map((slot, i) => (
              <div key={i} className="flex-row" style={{ marginBottom: '8px' }}>
                <input type="text" value={slot} onChange={(e) => { const next = [...slotsInput]; next[i] = e.target.value; setSlotsInput(next); }} placeholder={`チーム名 ${i + 1}`} style={{ flex: 1, margin: 0 }} />
                <button className="btn btn-secondary" style={{ padding: '6px 12px', marginLeft: '8px' }} onClick={() => setSlotsInput(slotsInput.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button className="btn btn-secondary" style={{ padding: '8px 14px', marginTop: '8px' }} onClick={() => setSlotsInput([...slotsInput, ''])}>+ 追加</button>
          </div>
        ) : (
          <div>
            {gameState?.teamSlots.length === 0 ? (
              <p style={{ color: 'var(--text-dim)' }}>未設定（プレイヤーは自由入力になります）</p>
            ) : (
              gameState?.teamSlots.map((slot, i) => {
                const joined = gameState.teams.find((t) => t.name === slot);
                return (
                  <div key={i} className="ranking-item">
                    <span style={{ width: '48px', fontWeight: 700, color: 'var(--accent)', fontSize: '1rem' }}>{formatSlotNumber(i)}</span>
                    <span style={{ flex: 1 }}>{slot}</span>
                    <span style={{ fontSize: '0.85rem', color: joined ? 'var(--win)' : 'var(--text-dim)' }}>
                      {joined ? '参加済み' : '未参加'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 最終結果発表の進行。司会のペースで1段ずつ進める */}
      {fr && frStage && (
        <div className="card">
          <h3>最終結果発表</h3>
          <div className="final-steps">
            {fr.stages.map((s, i) => (
              <span key={i} className={`final-step ${i < fr.step ? 'is-done' : i === fr.step ? 'is-current' : ''}`}>
                {stageLabel(s)}
              </span>
            ))}
          </div>
          <p style={{ margin: '12px 0' }}>
            ディスプレイに表示中: <strong>{stageLabel(frStage)}</strong>
            {frStage.teams.length > 0 && frStage.kind !== 'ranking' && (
              <span style={{ color: 'var(--text-dim)', marginLeft: '8px' }}>
                （{frStage.teams.map((t) => t.name).join('、')}）
              </span>
            )}
          </p>
          {frNext ? (
            <>
              <button className="btn btn-gold btn-next-action" onClick={finalRevealNext}>
                次へ：{stageLabel(frNext)}を発表
              </button>
              {/* 進行担当だけが次に何が出るか分かるようにしておく（司会への耳打ち用） */}
              {frNext.teams.length > 0 && frNext.kind !== 'ranking' && (
                <p className="next-action-hint">
                  {frNext.kind === 'champion' ? '優勝' : '次に出るチーム'}: {frNext.teams.map((t) => t.name).join('、')}
                </p>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--win)', fontWeight: 700 }}>すべて発表しました。お疲れさまでした。</p>
          )}
        </div>
      )}

      {/* チームランキング */}
      <div className="card">
        <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <h3>チームランキング ({gameState?.teams.length || 0}チーム)</h3>
          <div className="flex-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
            {/* 伏せる・見せるは最終問題フラグで自動的に決まる。ここでは状態を示すだけ */}
            <span
              className={`status-badge ${gameState?.rankingHidden ? 'status-revealed' : 'status-waiting'}`}
              style={{ alignSelf: 'center', fontSize: '0.85rem', padding: '6px 12px' }}
              title="最終問題を出題すると自動で伏せます"
            >
              {gameState?.rankingHidden ? '参加者に順位を伏せています' : '参加者に順位を公開中'}
            </span>
            {!fr && (
              <button
                className={`btn btn-gold ${!finalRevealBlocker && nextQuizIndex < 0 ? 'btn-next-action' : ''}`}
                style={{ padding: '8px 15px' }}
                onClick={handleFinalReveal}
                disabled={!!finalRevealBlocker}
                title={finalRevealBlocker ?? undefined}
              >
                最終結果発表を始める
              </button>
            )}
            {!fr && finalRevealBlocker && <span className="final-reveal-hint">{finalRevealBlocker}</span>}
            <a href="/display" target="_blank" className="btn btn-gold" style={{ padding: '8px 15px' }}>
              観客画面を開く
            </a>
          </div>
        </div>
        <div className="ranking">
          {(() => {
            const sorted = gameState?.teams.slice().sort((a, b) => b.points - a.points) || [];
            const rankedTeams: { id: string; name: string; points: number; hasDevice?: boolean; rank: number }[] = [];
            for (let i = 0; i < sorted.length; i++) {
              if (i === 0) {
                rankedTeams.push({ ...sorted[i], rank: 1 });
              } else {
                const prev = sorted[i - 1];
                const prevRank = rankedTeams[i - 1].rank;
                rankedTeams.push({ ...sorted[i], rank: sorted[i].points === prev.points ? prevRank : i + 1 });
              }
            }
            return rankedTeams.map((team) => (
              <div key={team.id} className={`ranking-item ${team.rank <= 3 ? 'top-3' : ''}`}>
                <span className={`rank rank-${Math.min(team.rank, 4)}`}>{team.rank}</span>
                <span style={{ flex: 1 }}>{team.name}</span>
                <span style={{ color: 'var(--accent)', marginRight: '15px' }}>{team.points.toLocaleString()} pt</span>
                {team.hasDevice ? (
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '0.8rem', marginRight: '6px' }}
                    title="スマホの電池切れ・端末交換時に。外すと別の端末からこのチームで参加できます"
                    onClick={() => { if (confirm(`「${team.name}」の端末の紐付けを外しますか？\n今の端末はチーム登録画面に戻り、別の端末からこのチームに参加できるようになります（ポイントは残ります）。`)) releaseDevice(team.id); }}
                  >
                    端末を外す
                  </button>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginRight: '6px' }}>端末なし</span>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ padding: '3px 8px', fontSize: '0.8rem' }}
                  onClick={() => { if (confirm(`「${team.name}」を削除しますか？`)) removeTeam(team.id); }}
                >
                  削除
                </button>
              </div>
            ));
          })()}
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginTop: '15px' }}>
          ※ゲームリセット: チームは残り、ポイントのみ初期値(0pt)に戻ります
        </p>
      </div>

      {/* リカバリー操作 */}
      <div className="card">
        <h3>リカバリー操作</h3>
        <div style={{ marginTop: '16px' }}>
          <h4>ポイント加算・減算</h4>
          <div className="flex-row" style={{ marginTop: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <select value={adjustTeamId} onChange={(e) => setAdjustTeamId(e.target.value)} style={{ flex: 1, minWidth: '150px' }}>
              <option value="">チームを選択</option>
              {gameState?.teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.points.toLocaleString()} pt)</option>
              ))}
            </select>
            <input type="number" value={adjustDelta || ''} onChange={(e) => setAdjustDelta(Number(e.target.value))} placeholder="例: 1000 or -500" style={{ flex: '0 1 160px', minWidth: '120px' }} />
            <button
              className="btn btn-gold"
              style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}
              disabled={!adjustTeamId || adjustDelta === 0}
              onClick={() => {
                const team = gameState?.teams.find((t) => t.id === adjustTeamId);
                if (!team) return;
                if (confirm(`「${team.name}」のポイントを ${adjustDelta > 0 ? '+' : ''}${adjustDelta.toLocaleString()} しますか？`)) {
                  adjustPoints(adjustTeamId, adjustDelta);
                  setAdjustDelta(0);
                }
              }}
            >
              実行
            </button>
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <h4>回答差し戻し（回答受付中のみ）</h4>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: '6px 0 10px' }}>
            ※回答受付中のクイズのみ有効。対象チームの回答を取り消し、再回答可能にします。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {canResetAnswer && currentAnswers.length > 0 ? (
              currentAnswers.map((a) => {
                const t = gameState?.teams.find((t) => t.id === a.teamId);
                if (!t) return null;
                return (
                  <div key={a.teamId} className="ranking-item">
                    <span style={{ flex: 1 }}>{t.name}</span>
                    <span style={{ color: 'var(--text-dim)', marginRight: '12px' }}>回答済み</span>
                    <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '0.85rem' }} onClick={() => { if (confirm(`「${t.name}」の回答を差し戻しますか？`)) resetAnswer(t.id); }}>
                      差し戻し
                    </button>
                  </div>
                );
              })
            ) : (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                {currentQuiz && currentQuiz.status !== 'answering'
                  ? '締め切り後は差し戻しできません'
                  : '回答済みのチームがありません'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* クイズ編集モーダル */}
      {editingQuiz && (
        <div className="result-overlay">
          <div className="result-card" style={{ maxWidth: '600px', textAlign: 'left' }}>
            <h3 style={{ marginBottom: '20px' }}>クイズ編集</h3>

            <label>問題文</label>
            <textarea
              value={editingQuiz.question}
              onChange={(e) => setEditingQuiz({ ...editingQuiz, question: e.target.value })}
              placeholder="問題文を入力"
            />

            <label>配分総額（正解したチームで山分けするポイント）</label>
            <input
              type="number"
              min="1"
              step="100"
              value={editingQuiz.prizePool}
              onChange={(e) => setEditingQuiz({ ...editingQuiz, prizePool: Number(e.target.value) })}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '15px 0' }}>
              <input
                type="checkbox"
                id="isLastQuiz"
                checked={!!editingQuiz.isLastQuiz}
                onChange={(e) => setEditingQuiz({ ...editingQuiz, isLastQuiz: e.target.checked })}
                style={{ width: '18px', height: '18px' }}
              />
              <label htmlFor="isLastQuiz" style={{ margin: 0, cursor: 'pointer' }}>
                最終問題（FINAL 予告が入り、この問題から順位・得点・投票内訳を自動で伏せます）
              </label>
            </div>

            <label>選択肢（2〜4個）と正解　※左の「正解」をタップして1つ選ぶ</label>
            {editingQuiz.options.map((opt, index) => (
              <div key={opt.id} className="flex-row" style={{ marginBottom: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`btn ${editingQuiz.correctOptionId === opt.id ? 'btn-gold' : 'btn-secondary'}`}
                  style={{ padding: '8px 12px', marginRight: '8px', whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                  aria-pressed={editingQuiz.correctOptionId === opt.id}
                  onClick={() => setEditingQuiz({ ...editingQuiz, correctOptionId: opt.id })}
                >
                  {editingQuiz.correctOptionId === opt.id ? '✓ 正解' : '正解'}
                </button>
                <input
                  type="text"
                  value={opt.text}
                  onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                  placeholder={`選択肢${index + 1}`}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" style={{ padding: '5px 10px', marginLeft: '8px' }} onClick={() => handleRemoveOption(opt.id)}>
                  ×
                </button>
              </div>
            ))}
            {editingQuiz.options.length < 4 && (
              <button className="btn btn-secondary" onClick={handleAddOption} style={{ marginTop: '5px' }}>
                選択肢追加
              </button>
            )}

            <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditingQuiz(null)} style={{ marginRight: '10px' }}>
                キャンセル
              </button>
              <button className="btn btn-gold" onClick={handleSaveQuiz}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;
