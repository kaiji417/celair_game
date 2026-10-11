// UI確認用: ローカルサーバー(3099)に10チームを入れ、指定の局面まで進める。
// 使い方: node tools/ui-snapshot.cjs <stage>
//   stage = answering | closed | revealed | payout | monopoly | final-<n>
const { io } = require('socket.io-client');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://localhost:3001';
const stage = process.argv[2] || 'closed';

(async () => {
  const { token } = await (await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'celiar' }),
  })).json();
  const admin = io(`${BASE}/admin`, { auth: { token } });
  await wait(300);
  admin.emit('fullReset'); await wait(200);
  const opts = [
    { id: 'a', text: '東京タワー' }, { id: 'b', text: 'スカイツリー' },
    { id: 'c', text: '通天閣' }, { id: 'd', text: '五稜郭タワー' },
  ];
  admin.emit('updateQuizzes', [
    { id: 'q1', question: '新郎新婦が初めてデートした場所は？', options: opts, correctOptionId: 'a', prizePool: 3000, status: 'waiting' },
    { id: 'q2', question: 'FINAL: 新婦の初恋の相手は？', options: opts.slice(0, 2), correctOptionId: 'a', prizePool: 10000, status: 'waiting', isLastQuiz: true },
  ]);
  const names = ['あおい', 'いちご', 'うさぎ', 'えだまめ', 'おにぎり', 'かもめ', 'きつね', 'くじら', 'けやき', 'こまち'];
  admin.emit('setTeamSlots', names); await wait(200);
  const players = [];
  for (const n of names) {
    const p = io(`${BASE}/player`); await wait(80);
    const r = await new Promise((res) => p.emit('joinTeam', { teamName: n }, res));
    players.push({ p, token: r.token });
  }
  admin.emit('startQuiz', 0); await wait(300);
  // monopoly: 1チームだけ正解 / それ以外: 多数派が外れる配分
  const picks = stage.startsWith('monopoly')
    ? ['a', 'b', 'b', 'b', 'b', 'c', 'c', 'd', 'b', 'c']
    : ['b', 'b', 'b', 'b', 'b', 'a', 'a', 'c', 'd', 'a'];
  for (let i = 0; i < players.length - (stage === 'answering' ? 4 : 0); i++) {
    await new Promise((res) => players[i].p.emit('submitAnswer', { quizId: 'q1', optionId: picks[i], token: players[i].token }, res));
  }
  if (stage === 'answering') return done();
  admin.emit('closeAnswers'); await wait(200);
  if (stage === 'closed' || stage === 'monopoly-closed') return done();
  admin.emit('revealAnswer', { correctOptionId: 'a' }); await wait(300);
  if (stage === 'revealed') return done();
  if (stage === 'payout' || stage === 'monopoly') { admin.emit('showResults'); return done(); }
  if (stage.startsWith('final-')) {
    // 順位をばらけさせる（単独優勝・2位・3位がいる形）
    const bonus = { 'かもめ': 2500, 'きつね': 1800, 'こまち': 900, 'くじら': 600, 'あおい': 300 };
    // チームIDを取るために現在の状態を受け取る（参加者を追加すると管理画面に gameState が届く）
    const st = await new Promise((res) => { admin.once('gameState', res); admin.emit('setTeamSlots', names); });
    for (const t of st.teams) if (bonus[t.name]) admin.emit('adjustPoints', t.id, bonus[t.name]);
    await wait(300);
    // 最終問題（q2）を出して答え合わせまで進める（最終結果発表の前提）
    admin.emit('startQuiz', 1); await wait(300);
    for (let i = 0; i < players.length; i++) {
      await new Promise((res) => players[i].p.emit('submitAnswer', { quizId: 'q2', optionId: 'b', token: players[i].token }, res));
    }
    admin.emit('closeAnswers'); await wait(150);
    admin.emit('revealAnswer', { correctOptionId: 'a' }); await wait(300);
    const n = Number(stage.split('-')[1]);
    for (let i = 0; i <= n; i++) { admin.emit('finalRevealNext'); await wait(200); }
    return done();
  }
  done();

  function done() { setTimeout(() => process.exit(0), 300); }
})();
