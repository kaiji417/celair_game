// UI確認用: 管理者操作を1つだけ送る。 node tools/ui-action.cjs <event> [jsonArg]
const { io } = require('socket.io-client');
const [event, arg] = process.argv.slice(2);
(async () => {
  const { token } = await (await fetch('http://localhost:3001/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'celiar' }),
  })).json();
  const admin = io('http://localhost:3001/admin', { auth: { token } });
  admin.on('connect', () => {
    // revealAnswer は選択肢IDだけ渡せばよいようにする（シェルのクォート崩れ対策）
    if (event === 'revealAnswer') admin.emit(event, { correctOptionId: arg });
    else if (arg !== undefined) admin.emit(event, JSON.parse(arg));
    else admin.emit(event);
    setTimeout(() => process.exit(0), 300);
  });
})();
