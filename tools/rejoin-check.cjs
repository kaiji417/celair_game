// 再読み込み・ブラウザ再起動でチームに戻れるかの確認。
// 前提: ローカルサーバーが 3001 で起動していること（検証用の STATE_FILE で）
// 使い方: node tools/rejoin-check.cjs
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'http://localhost:3001';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openBrowser(profile) {
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
  const text = async () => (await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })).result.value;
  const close = async () => { ws.close(); edge.kill(); await wait(800); };
  return { send, text, close };
}

(async () => {
  const { token } = await (await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'celiar' }),
  })).json();
  const admin = io(`${BASE}/admin`, { auth: { token } });
  await wait(400);
  admin.emit('fullReset'); await wait(200);
  admin.emit('setTeamSlots', ['あおい', 'いちご']); await wait(300);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'celiar-rejoin-'));
  const inTeam = (t) => !t.includes('チーム登録');

  // 1. 参加
  let b = await openBrowser(profile);
  await b.send('Page.navigate', { url: `${BASE}/player` }); await wait(2500);
  await b.send('Runtime.evaluate', { expression: "[...document.querySelectorAll('.team-slot-card')].find(x => x.textContent.includes('あおい')).click()" });
  await wait(300);
  await b.send('Runtime.evaluate', { expression: "[...document.querySelectorAll('button')].find(x => x.textContent.includes('参加する')).click()" });
  await wait(1200);
  console.log('参加:', inTeam(await b.text()) ? 'OK' : 'NG');

  // 2. 再読み込み
  await b.send('Page.reload'); await wait(2500);
  console.log('再読み込み:', inTeam(await b.text()) ? 'OK' : 'NG');

  // 3. ゲーム中（出題後）の再読み込み
  admin.emit('updateQuizzes', [{ id: 'q', question: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionId: 'a', prizePool: 1000, status: 'waiting' }]);
  await wait(200); admin.emit('startQuiz', 0); await wait(500);
  await b.send('Page.reload'); await wait(2500);
  console.log('出題中に再読み込み:', inTeam(await b.text()) ? 'OK' : 'NG');

  // 4. ブラウザを落として開き直す（同じプロファイル = 同じスマホ）
  await b.close();
  b = await openBrowser(profile);
  await b.send('Page.navigate', { url: `${BASE}/player` }); await wait(3000);
  console.log('ブラウザ再起動:', inTeam(await b.text()) ? 'OK' : 'NG');

  // 5. 回線が遅い場合（応答を 6 秒遅らせる）でも、登録画面に落ちずに戻れるか
  await b.send('Network.enable');
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 3000, downloadThroughput: -1, uploadThroughput: -1 });
  await b.send('Page.reload'); await wait(6000);
  const mid = await b.text();
  console.log('低速回線(6秒時点):', mid.includes('チーム登録') ? 'NG(登録画面に落ちた)' : 'OK(待機 or 復帰済み)');
  await wait(12000);
  console.log('低速回線(最終):', inTeam(await b.text()) ? 'OK' : 'NG');

  await b.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
