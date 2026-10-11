// 操作説明スライド用: 参加者画面（スマホ）を各場面で撮る。
// 前提: ローカルサーバーが 3001 で起動していること（frontend/.env の VITE_SERVER_URL と合わせる）
// 使い方: node tools/phone-shots.cjs <出力フォルダ>
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'celiar-shots');
const BASE = 'http://localhost:3001';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'celiar-edge-'));
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* 起動待ち */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true });
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.data, 'base64'));
  };

  // 管理者として準備
  const { token } = await (await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'celiar' }),
  })).json();
  const admin = io(`${BASE}/admin`, { auth: { token } });
  await wait(400);
  admin.emit('fullReset'); await wait(200);
  const names = ['あおい', 'いちご', 'うさぎ', 'えだまめ', 'おにぎり', 'かもめ', 'きつね', 'くじら'];
  admin.emit('setTeamSlots', names);
  admin.emit('updateQuizzes', [{
    id: 'q1', question: '新郎新婦が初めてデートした場所は？', prizePool: 3000, status: 'waiting',
    options: [{ id: 'a', text: '東京タワー' }, { id: 'b', text: 'スカイツリー' }, { id: 'c', text: '通天閣' }, { id: 'd', text: '五稜郭タワー' }],
  }]);
  await wait(300);

  // 他チームは裏で参加させておく（チーム選択画面に「参加済み」が混ざる様子を見せる）
  const others = [];
  for (const n of ['いちご', 'えだまめ', 'かもめ']) {
    const p = io(`${BASE}/player`); await wait(100);
    const r = await new Promise((res) => p.emit('joinTeam', { teamName: n }, res));
    others.push({ p, token: r.token });
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${BASE}/player` });
  await wait(2500);

  // 1. チーム選択（1つ選んだ状態）
  await run("[...document.querySelectorAll('.team-slot-card')].find(b => b.textContent.includes('あおい')).click()");
  await wait(400);
  await shot('phone-1-join');

  // 2. 参加 → 待機画面
  await run("[...document.querySelectorAll('button')].find(b => b.textContent.includes('参加する')).click()");
  await wait(1000);
  await shot('phone-2-waiting');

  // 3. 出題 → 選択肢を選んだ状態（まだ送っていない）
  admin.emit('startQuiz', 0); await wait(1200);
  await run("[...document.querySelectorAll('.option-btn')][0].click()");
  await wait(400);
  await shot('phone-3-select');

  // 4. 回答済み
  await run("[...document.querySelectorAll('button')].find(b => b.textContent.includes('回答する')).click()");
  await wait(1000);
  await shot('phone-4-answered');

  // 他チームも回答
  const picks = ['b', 'a', 'b'];
  for (let i = 0; i < others.length; i++) {
    await new Promise((res) => others[i].p.emit('submitAnswer', { quizId: 'q1', optionId: picks[i], token: others[i].token }, res));
  }

  // 5. 締め切り
  admin.emit('closeAnswers'); await wait(1200);
  await shot('phone-5-closed');

  // 6. 正解発表（参加者画面は会場の演出が終わってから結果を出すので待つ）
  admin.emit('revealAnswer', { correctOptionId: 'a' });
  // 消去演出(約5秒)＋得点のカウントアップ(約1.7秒)が終わるまで待つ
  await wait(10500);
  await shot('phone-6-result');

  ws.close();
  edge.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
})().catch((e) => { console.error(e); process.exit(1); });
