#!/usr/bin/env bash
# Delta — start /api + /web dev servers in one window.
# Streams logs from both. Press Ctrl-C to stop both.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo
  echo "→ stopping…"
  if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "→ Delta dev — starting /api and /web"
echo "  API will run on :4000"
echo "  WEB will run on :5173"
echo

cd "$REPO_ROOT/api"
node --env-file=.env src/server.js 2>&1 | sed 's/^/[api] /' &
API_PID=$!

cd "$REPO_ROOT/web"
npm run dev 2>&1 | sed 's/^/[web] /' &
WEB_PID=$!

echo "→ both running. Open http://localhost:5173 in a browser."
echo "  Press Ctrl-C here to stop."
echo

wait
