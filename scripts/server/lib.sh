# Shared by the server scripts. Run them from the deploy folder (default /opt/explorehills).
set -euo pipefail
ENV_FILE="${ENV_FILE:-.env.production}"
export ENV_FILE
compose() { docker compose --env-file "$ENV_FILE" -f docker-compose.server.yml "$@"; }
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
current_release() { cat releases/current 2>/dev/null || true; }
previous_release() { cat releases/previous 2>/dev/null || true; }

# Waits until the app container reports healthy. Fails when it dies or runs out of time.
wait_for_app() {
  local id status
  for _ in $(seq 1 60); do
    id=$(compose ps -q app)
    status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo none)
    [ "$status" = healthy ] && return 0
    sleep 3
  done
  return 1
}
