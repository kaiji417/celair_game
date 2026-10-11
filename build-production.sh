#!/bin/bash

echo "🔨 Building Kaiji Quiz for Production..."

# shared パッケージをビルド
echo "📦 Building shared package..."
cd shared
npm install
npx tsc
cd ..

# backend パッケージをビルド
echo "🖥️  Building backend..."
cd backend
npm install
npx tsc
cd ..

# frontend パッケージをビルド
echo "🎨 Building frontend..."
cd frontend
npm install
npx vite build
cd ..

echo "✅ Build complete!"
echo ""
echo "To start the production server:"
echo "  cd backend"
echo "  node dist/index.js"
echo ""
echo "Then access: http://localhost:3001"
