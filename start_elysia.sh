#!/bin/bash
# ELYSIA Start Script (Linux/macOS)
# Ensure we're in the project root
cd "$(dirname "$0")" || exit 1

# Kill any ghost processes
pkill -f "uvicorn agent.server:app" 2>/dev/null || true

echo "Starting ELYSIA..."

# 1. Start Python Agent
echo ">>> Starting Python Agent on Port 8765..."
python scripts/run_agent.py &
PYTHON_PID=$!

sleep 2

# 2. Start Node Server + Vite
echo ">>> Starting Node Server & Vite Frontend..."
npm run dev &
NODE_PID=$!

echo ""
echo "=================================================="
echo "ELYSIA is running at: http://localhost:3000"
echo "Press Ctrl+C to stop"
echo "=================================================="

trap "echo 'Shutting down...'; kill $PYTHON_PID $NODE_PID 2>/dev/null; exit" SIGINT SIGTERM

wait
