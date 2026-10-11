// UI確認用: 最終問題（自動で順位・得点・投票内訳を伏せる）→ 最終結果発表 までを再現する。
// 使い方: node tools/ui-hidden.cjs <stage>
//   stage = closed（最終問題の締め切り）| revealed（最終問題の正解発表）| final（最終発表を開始）
// 他チームの回答・参加者の結果シートは、表示中ページとは別に、ここで1チーム分を受信して標準出力に出す
const { io } = require('socket.io-client');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://localhost:3001';
const stage = process.argv[2] || 'closed';

(async () => {
  const { token } = await (await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'celiar' }),
  })).json();
  const admin = io(`${BASE}/admin`, { auth: { token } });
  admin.on('adminError', (m) => console.log('adminError:', m));
  await wait(300);
  admin.emit('fullReset'); await wait(200);
  const opts = [{ id: 'a', text: '東京タワー' }, { id: 'b', text: 'スカイツリー' }, { id: 'c', text: '通天閣' }, { id: 'd', text: '五稜郭タワー' }];
  admin.emit('updateQuizzes', [
    { id: 'q1', question: 'Q1 ふたりの出身地は？', options: opts.slice(0, 2), prizePool: 1000, status: 'waiting' },
    { id: 'q2', question: '新郎新婦が初めてデートした場所は？', options: opts, prizePool: 3000, status: 'waiting', isLastQuiz: true },
  ]);
  const names = ['あおい', 'いちご', 'うさぎ', 'えだまめ', 'おにぎり', 'かもめ', 'きつね', 'くじら'];
  admin.emit('setTeamSlots', names); await wait(200);
  const players = [];
  for (const n of names) {
    const p = io(`${BASE}/player`); await wait(80);
    const r = await new Promise((res) => p.emit('joinTeam', { teamName: n }, res));
    players.push({ p, token: r.token, name: n });
  }
  const answer = async (quizId, picks) => {
    for (let i = 0; i < players.length; i++) {
      await new Promise((res) => players[i].p.emit('submitAnswer', { quizId, optionId: picks[i], token: players[i].token }, res));
    }
  };

  // Q1 は公開中に1問やって得点差をつける
  admin.emit('startQuiz', 0); await wait(200);
  await answer('q1', ['a', 'a', 'b', 'b', 'b', 'a', 'b', 'b']);
  admin.emit('closeAnswers'); await wait(150);
  admin.emit('revealAnswer', { correctOptionId: 'a' }); await wait(300);

  // 最終問題を出題した時点から自動で伏せる
  admin.emit('startQuiz', 1); await wait(300);

  // 「あおい」の端末が受け取る内容を記録する
  const watch = players[0].p;
  let lastState;
  watch.on('gameState', (s) => { lastState = s; });
  watch.on('resultRevealed', (r) => console.log('あおい resultRevealed:', JSON.stringify(r)));

  await answer('q2', ['a', 'b', 'b', 'b', 'b', 'a', 'c', 'd']);
  admin.emit('closeAnswers'); await wait(400);
  if (stage === 'closed') {
    const visible = lastState.answers.filter((a) => a.quizId === 'q2' && a.optionId).length;
    console.log('非表示中・締め切り後に参加者へ届いた optionId 付きの回答数:', visible);
    console.log('参加者へ届いた得点:', lastState.teams.map((t) => t.points).join(','));
    return done();
  }
  admin.emit('revealAnswer', { correctOptionId: 'a' }); await wait(500);
  if (stage === 'revealed') { admin.emit('showResults'); return done(); }

  if (stage === 'final') {
    admin.emit('finalRevealNext'); await wait(300);
    return done();
  }
  done();

  function done() { setTimeout(() => process.exit(0), 300); }
})();
