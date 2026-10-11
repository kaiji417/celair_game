#!/bin/bash
# ===== Kaiji Quiz - Mac セットアップスクリプト =====
# このスクリプトを実行するだけで全部やってくれます
#
# 使い方:
#   1. ターミナルを開く（Macの「アプリケーション」→「ユーティリティ」→「ターミナル」）
#   2. kaiji-quizフォルダに移動: cd /path/to/kaiji-quiz
#   3. 実行権限を付与: chmod +x setup-mac.sh
#   4. 実行: ./setup-mac.sh

set -e

echo ""
echo "========================================="
echo "  Kaiji Quiz セットアップ開始"
echo "========================================="
echo ""

# --- Step 1: Homebrewの確認 ---
if ! command -v brew &> /dev/null; then
  echo "[1/4] Homebrew が見つかりません。インストールします..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon Mac の場合、パスを通す
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  fi
else
  echo "[1/4] Homebrew ... OK"
fi

# --- Step 2: Node.jsの確認 ---
if ! command -v node &> /dev/null; then
  echo "[2/4] Node.js が見つかりません。インストールします..."
  brew install node
else
  echo "[2/4] Node.js ... OK ($(node -v))"
fi

# --- Step 3: 依存関係インストール ---
echo "[3/4] 依存関係をインストール中..."
npm install

# --- Step 4: ビルド ---
echo "[4/4] ビルド中..."
npm run build

echo ""
echo "========================================="
echo "  セットアップ完了！"
echo "========================================="
echo ""
echo "  起動コマンド:  npm start"
echo "  起動後のURL:   http://localhost:3000"
echo ""
echo "  参加者ページ:  http://localhost:3000/player"
echo "  管理者ページ:  http://localhost:3000/admin"
echo "  表示用ページ:  http://localhost:3000/display"
echo ""
echo "  管理者パスワード: kaiji2026"
echo ""
