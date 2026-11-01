#!/usr/bin/env bash
# Starts the built app and worker against the load database, runs the load, and stops them.
# Usage: scripts/load/run.sh [seconds] [streams] [pause ms]   (npm run build && npm run build:worker first)
set -euo pipefail
. scripts/load/env.sh
npx next start -p "$APP_PORT" > /tmp/explorehills_load_app.log 2>&1 &
app=$!
node dist/worker.js > /tmp/explorehills_load_worker.log 2>&1 &
worker=$!
trap 'kill $app $worker 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "$APP_URL/api/health" > /dev/null && break; sleep 1; done
node scripts/load/run.mjs "$APP_URL" "${1:-120}" "${2:-300}" "${3:-2000}"
echo "app memory after the run: $(($(pgrep -P $app -f next | head -1 | xargs -I{} ps -o rss= -p {} 2>/dev/null || ps -o rss= -p $app) / 1024)) MB"
