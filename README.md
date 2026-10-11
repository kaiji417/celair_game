# CELIAR GAME

結婚式二次会向けのリアルタイム参加型クイズゲーム。
各問に設定された「配分総額」を、正解したチームで山分けする**銀行配当型**。

- 全チーム **0ポイント** スタート
- 減点なし（増えるか据え置きのみ）
- 選択肢を選ぶだけ（賭け額の入力は不要）
- 少数だけが正解した難問ほど、1チームあたりの取り分が大きい

ルールの詳細は [CE_LIAR_GAME_SPEC.md](./CE_LIAR_GAME_SPEC.md) を参照。

---

## 画面と想定デバイス

| パス | 用途 | デバイス |
|------|------|----------|
| `/player` | 参加者がチーム登録・回答する | スマホ |
| `/admin` | 進行操作・クイズ作成・リカバリー | PC |
| `/display` | 観客向けのランキングと演出 | 大画面モニター / プロジェクター（1920x1080想定） |

---

## セットアップ

```bash
npm install
npm run build
```

`shared` → `frontend` → `backend` の順でビルドされます。
`shared/src/types.ts` を変更したら `npm run build:shared` を実行してください。
これを忘れると backend / frontend 側で型エラーになります。

---

## 開発モード

ターミナルを2つ使います。

```bash
# バックエンド（ポート3001）
cd backend && npx ts-node-dev --respawn src/index.ts

# フロントエンド（ポート5173）
cd frontend && npx vite
```

Vite のプロキシ設定により `/api` と `/socket.io` はバックエンドへ転送されます。

## 本番モード（ローカル確認）

```bash
npm run build
npm start
```

---

## テスト

```bash
npx vitest run --root backend
```

配当計算（山分け・端数切り捨て・正解者ゼロ）と GameState のシリアライズを検証します。

---

## 環境変数

| 変数 | 用途 | デフォルト |
|------|------|-----------|
| `ADMIN_PASSWORD` | 管理者画面のパスワード | `celiar`（`NODE_ENV=production` では8文字以上の独自値が必須。未設定だと起動しない） |
| `PORT` | サーバーのポート | `3001` |
| `STATE_FILE` | ゲーム状態の保存先 | `game-state.json`（リポジトリ直下） |
| `VITE_SERVER_URL` | フロントから見たサーバーURL（frontend/.env） | `window.location.origin` |

---

## デプロイ（参加者は自分のスマホ回線からアクセス）

Render（Web Service）を利用。`render.yaml` に設定があります。会場 Wi-Fi に依存せず、参加者は普通のスマホ（4G/5G）から `https://<サービス名>.onrender.com/player` に入れます。

- ビルド: `npm install && npm run build` / 起動: `npm start`
- `ADMIN_PASSWORD` は Render ダッシュボードで手動設定（`sync: false`）
- 状態は永続ディスク（`/var/data`）に保存。永続ディスクには Starter 以上のプランが必要。Free プランは再起動で状態が消え、無通信が続くとスリープする
- QR コードの URL は管理画面が公開 URL を自動で入れる

## セキュリティ

- 管理者操作はログイン時に発行するトークンを Socket 接続時に検証する。未認証の接続は拒否
- ログイン失敗は同一 IP から 10 分で 10 回までに制限
- 参加者は 1チーム1端末。参加時に発行される端末トークンで回答する（他チーム名での回答・なりすまし不可）
- チーム名リストを登録しておくと、リスト外の名前でのチーム作成を拒否する（公開 URL での荒らし対策）

---

## 状態の永続化

ゲーム状態は `game-state.json` に自動保存され、サーバー再起動時に復元されます。
リハーサル後は管理者画面の「完全リセット」でチームごと初期化してください。
