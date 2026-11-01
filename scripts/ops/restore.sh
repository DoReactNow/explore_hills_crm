#!/usr/bin/env bash
# Restores a backup into an EMPTY database and folder, after checking its checksums. It never overwrites:
# restoring over live data is a decision for a person, who empties the target first. After a real restore,
# erase again any customer erased since the backup was taken (CONTEXT/dpdp_checklist.md).
# Usage: RESTORE_DATABASE_URL=... scripts/ops/restore.sh <backup folder> [empty storage folder]
set -euo pipefail
source="${1:?give the backup folder}"
storage="${2:-}"
: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL}"
(cd "$source" && { sha256sum --check --quiet checksums.sha256 2>/dev/null || shasum -a 256 --check --quiet checksums.sha256; })
tables=$(${PG_TOOLS:-} psql "$RESTORE_DATABASE_URL" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
if [ "$tables" != "0" ]; then echo "Refusing: the target database is not empty" >&2; exit 1; fi
${PG_TOOLS:-} pg_restore --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_DATABASE_URL" < "$source/database.dump"
if [ -n "$storage" ]; then
  mkdir -p "$storage"
  if [ -n "$(ls -A "$storage")" ]; then echo "Refusing: the storage folder is not empty" >&2; exit 1; fi
  tar -xzf "$source/files.tar.gz" -C "$storage"
fi
echo "Restored from $source"
