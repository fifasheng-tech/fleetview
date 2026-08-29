#!/bin/bash
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDF="$DIR/fleet.pid"

if [ -f "$PIDF" ]; then
  PID="$(cat "$PIDF")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "[✓] 已停止 FleetView (pid $PID)"
  else
    echo "[=] 进程 $PID 已不存在"
  fi
  rm -f "$PIDF"
else
  pkill -f "python3 server.py" 2>/dev/null && echo "[✓] 已按进程名停止" || echo "[=] FleetView 未在运行"
fi
