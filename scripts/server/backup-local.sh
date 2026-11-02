#!/usr/bin/env bash
# Writes a backup on this server. Usage: scripts/backup-local.sh <new folder> [--database-only]
. "$(dirname "$0")/lib.sh"
target="${1:?give a new folder}"
storage=""
[ "${2:-}" = "--database-only" ] || storage="$(env_value STORAGE_HOST_DIR)"
[ "${2:-}" = "--database-only" ] || storage="${storage:-./storage}"
user=$(env_value POSTGRES_USER)
db=$(env_value POSTGRES_DB)
pass=$(env_value POSTGRES_PASSWORD)
PG_TOOLS="docker compose --env-file $ENV_FILE -f docker-compose.server.yml exec -T db" \
  BACKUP_DATABASE_URL="postgresql://$user:$pass@127.0.0.1:5432/$db" \
  "$(dirname "$0")/backup.sh" "$target" $storage
