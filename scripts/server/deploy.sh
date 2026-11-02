#!/usr/bin/env bash
# Puts a version live: backup, migrate, sync permissions, new app, health check, new worker.
# Anything failing before the health check leaves the previous version serving. The worker keeps running
# through the app's change, and is replaced last.
# Usage: scripts/deploy.sh <version tag>
. "$(dirname "$0")/lib.sh"
tag="${1:?give the version tag to deploy}"
mkdir -p releases backups
previous=$(current_release)

compose up -d db
for _ in $(seq 1 40); do
  compose exec -T db pg_isready -q -U "$(env_value POSTGRES_USER)" && break
  sleep 2
done

if [ -n "$previous" ]; then
  echo "[deploy] backing up the database first"
  "$(dirname "$0")/backup-local.sh" "backups/before-$tag-$(date -u +%Y%m%d-%H%M%S)" --database-only
fi

echo "[deploy] migrating"
if ! IMAGE_TAG="$tag" compose run --rm -T migrate; then
  echo "[deploy] the migration failed; version ${previous:-none} keeps running" >&2
  exit 1
fi
IMAGE_TAG="$tag" compose run --rm -T migrate node dist/sync-rbac.js

echo "[deploy] starting the new app"
IMAGE_TAG="$tag" compose up -d --no-deps app
if ! wait_for_app; then
  echo "[deploy] the new app is not healthy; going back to ${previous:-nothing}" >&2
  compose logs --tail=40 app >&2 || true
  [ -n "$previous" ] && IMAGE_TAG="$previous" compose up -d --no-deps app
  exit 1
fi

IMAGE_TAG="$tag" compose up -d --no-deps worker
IMAGE_TAG="$tag" compose up -d --no-deps caddy

# Keeps the running version and the one before it; only the version that just fell off is removed.
dropped=$(previous_release)
if [ "$previous" != "$tag" ]; then
  [ -n "$previous" ] && echo "$previous" > releases/previous
  echo "$tag" > releases/current
  if [ -n "$dropped" ] && [ "$dropped" != "$tag" ] && [ "$dropped" != "$previous" ]; then
    for image in explorehills-app explorehills-worker explorehills-migrator; do
      docker rmi "$image:$dropped" > /dev/null 2>&1 || true
    done
  fi
fi
echo "[deploy] version $tag is live"
