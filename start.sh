#!/bin/bash
# FleetView 启动脚本 —— 可重复执行，不会重复起进程
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${FLEET_PORT:-8790}"
LOG="$DIR/fleet.log"
PIDF="$DIR/fleet.pid"

if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  echo "[=] FleetView 已在运行 (pid $(cat "$PIDF")) → http://127.0.0.1:$PORT"
  exit 0
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[!] 端口 $PORT 已被占用，先执行 ./stop.sh 或换 FLEET_PORT"
  exit 1
fi

cd "$DIR" || exit 1
FLEET_PORT="$PORT" nohup python3 server.py >>"$LOG" 2>&1 &
echo $! >"$PIDF"
sleep 2

if kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  echo "[✓] FleetView 已启动 → http://127.0.0.1:$PORT  (pid $(cat "$PIDF"))"
  echo "    日志: $LOG"
else
  echo "[✗] 启动失败，见 $LOG"
  tail -20 "$LOG"
  rm -f "$PIDF"
  exit 1
fi
