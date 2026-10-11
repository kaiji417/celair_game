#!/bin/bash

echo "🚀 Starting Kaiji Quiz Production Server..."
echo ""
echo "Server will be available at:"
echo "  - Local: http://localhost:3001"
echo "  - Network: http://[YOUR_IP]:3001"
echo ""
echo "To find your IP address, run: ifconfig | grep 'inet '"
echo ""

cd backend
node dist/index.js
