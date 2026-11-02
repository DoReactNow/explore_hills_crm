#!/usr/bin/env bash
# Backs up the database (including the job queue) and the stored files into a new folder, with
# checksums, so a restore can prove it got everything. Holds customer data: keep it private, and off this
# server (Phase 12). Cloud storage is copied with `npm run storage:copy` instead (Decision 31).
# Usage: BACKUP_DATABASE_URL=... scripts/ops/backup.sh <new folder> [storage folder]
#        PG_TOOLS="docker exec -i container" runs pg_dump inside a container.
set -euo pipefail
target="${1:?give a new folder for the backup}"
storage="${2:-}"
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
if [ -e "$target" ]; then echo "Refusing: $target already exists" >&2; exit 1; fi
mkdir -p "$target"
chmod 700 "$target"
${PG_TOOLS:-} pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" > "$target/database.dump"
if [ -n "$storage" ]; then tar -czf "$target/files.tar.gz" -C "$storage" .; fi
(cd "$target" && { sha256sum ./* 2>/dev/null || shasum -a 256 ./*; } > checksums.sha256)
echo "Backup written to $target"
