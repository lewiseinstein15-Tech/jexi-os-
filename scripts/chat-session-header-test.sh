#!/usr/bin/env bash
# GAP 5 (fix/chat-wiring-completion) — SESSION HEADER honored + fallback proof.
# Boots the server, curls /api/chat twice (with / without x-jexi-session),
# then greps the server log for the per-turn resolution lines.
set -u
cd "$(dirname "$0")/.."
SERVER_DIR="server"
LOG="$(mktemp /tmp/jexi-gap5-server.XXXXXX.log)"
PORT_FREE=$(ss -ltn 2>/dev/null | grep -c ':3002 ' || true)

echo "== GAP 5 — SESSION HEADER TEST =="
if [ "$PORT_FREE" != "0" ]; then
  echo "[boot] something already serves :3002 — using it (logs not capturable; aborting for a clean run)"
  exit 2
fi

echo "[boot] starting server (log: $LOG)"
(cd "$SERVER_DIR" && node index.js > "$LOG" 2>&1 & echo $! > /tmp/jexi-gap5.pid)
for i in $(seq 1 60); do
  curl -s -o /dev/null -m 2 "http://127.0.0.1:3002/api/health" && break
  sleep 1
done
echo "[boot] server up"

SESSION="gap5-header-test-$$"
echo
echo "--- curl 1: WITH x-jexi-session header ---"
curl -s -N -m 90 -X POST "http://127.0.0.1:3002/api/chat" \
  -H 'content-type: application/json' \
  -H "x-jexi-session: $SESSION" \
  -d '{"query":"say ok"}' | head -c 400
echo
echo
echo "--- curl 2: WITHOUT the header (fallback expected) ---"
curl -s -N -m 90 -X POST "http://127.0.0.1:3002/api/chat" \
  -H 'content-type: application/json' \
  -d '{"query":"say ok"}' | head -c 400
echo
sleep 1

echo
echo "--- server log lines (session resolution) ---"
grep -E '^\[chat\] session=' "$LOG" | tail -4

WITH=$(grep -c "session=${SESSION} source=x-jexi-session header" "$LOG" || true)
WITHOUT=$(grep -c "source=fallback(ip)" "$LOG" || true)
echo
if [ "$WITH" -ge 1 ] && [ "$WITHOUT" -ge 1 ]; then
  echo "== RESULT: ALL PASS — header honored ($WITH hit), fallback verified ($WITHOUT hit) =="
  RC=0
else
  echo "== RESULT: FAIL — with-header hits=$WITH, fallback hits=$WITHOUT =="
  RC=1
fi

kill "$(cat /tmp/jexi-gap5.pid)" 2>/dev/null || true
rm -f /tmp/jexi-gap5.pid
exit $RC
