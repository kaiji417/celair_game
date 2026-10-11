# 本番反映アクションリスト（GitHub + Render Starter + 永続ディスク）

前提: サーバー1台構成（台数は増やさない）。クイズ・チームは本番の管理画面で作り直す。

## 1. 準備（1回だけ）

- [ ] GitHub Desktop をインストール（コマンド不要。Git も同梱）
- [ ] GitHub アカウント作成 / ログイン
- [ ] Render アカウント作成（GitHub でサインアップすると連携が楽）
- [ ] Render に支払い方法を登録（Starter + ディスクは有料。料金は公式サイトで確認）

## 2. GitHub に上げる（GitHub Desktop・初回のみ）

ファイルを個別に選ぶ必要はない。フォルダごと登録すれば `.gitignore` が不要なもの（`node_modules`・`dist`・`.env`・`game-state.json`）を自動で除外する。

- [ ] GitHub Desktop にサインイン（File → Options → Accounts）
- [ ] File → Add local repository → `ce-liar-game` フォルダを選択
  - 「Git リポジトリではありません」と出たら create a repository を押す（名前はそのまま、Git ignore は None）
- [ ] 左の変更一覧に次が**入っていない**ことを確認
  - `frontend/.env`（localhost 固定。入るとスマホから繋がらない）
  - `game-state.json`
  - `node_modules/` / `dist/`
- [ ] 左下の Summary に「initial」と入れて Commit to main
- [ ] 上部の Publish repository を押す
  - Keep this code private に**チェックを入れたまま** Publish
- [ ] github.com で Private リポジトリができていることを確認

## 3. Render にデプロイ

- [ ] Render ダッシュボード → New → Blueprint → リポジトリを選択（`render.yaml` が読まれる）
- [ ] プランが Starter、ディスク `/var/data` が付いていることを確認
- [ ] Environment で `ADMIN_PASSWORD` を設定（8文字以上・推測されにくい値。未設定だと起動しない）
- [ ] Instances は 1 のまま（スケールしない）
- [ ] デプロイ完了後、`https://<サービス名>.onrender.com/healthz` が開けることを確認

## 4. 本番の初期設定

- [ ] `/admin` にログイン
- [ ] クイズを登録（各問の正解・配分総額・最終問題フラグ）
- [ ] チーム名リストを登録（スプシのチーム名と一致させる）
- [ ] 管理画面の QR から、テーブル用 QR を作って印刷

## 5. リハーサル（会場と同じ機材で）

- [ ] 会場の PC で `/display` を全画面表示（1920x1080）
- [ ] スマホ数台（4G/5G、Wi-Fi オフ）で `/player` から参加
- [ ] 1問目〜最終問題 → 最終結果発表（4位以下 → 3位 → 2位 → 優勝 → 全順位）まで通す
- [ ] 途中でスマホをスリープ・再読み込みして、復帰できることを確認
- [ ] 終わったら「完全リセット」（クイズは残る。チーム・ポイント・回答が消える）
- [ ] 再度チーム名リストを登録

## 6. 当日

- [ ] 開始前に `/admin` と `/display` を開いておく
- [ ] Render のサービスが Live になっていることを確認
- [ ] 予備: 管理用 PC が落ちたら別端末で `/admin` に入り直せば続行できる

## 7. 終了後

- [ ] 必要ならランキングのスクショを保存
- [ ] Render でサービスを Suspend または Delete（課金停止。Delete するとディスクのデータも消える）

## コードを直したとき

- [ ] GitHub Desktop を開く（変更したファイルは自動で一覧に出る。どれを直したか覚えておく必要はない）
- [ ] Summary に内容を一言書いて Commit to main → 上部の Push origin
- [ ] Render が自動で再デプロイ（ダッシュボードで Live になれば反映済み）
- [ ] デプロイ中は数十秒〜数分つながらないので、本番中は push しない
- [ ] 状態はディスクに残るので、再デプロイしてもクイズ・ポイントは消えない
