#!/usr/bin/env bash
# The nightly job (Decision 69): backs up the database and files, encrypts them with rclone on the way out,
# copies them to Google Drive, removes old copies, and stamps success so the app can notice a missed night.
# rclone runs from its image. Its setup is in the runbook; its config holds the encryption passwords.
# Usage (cron, from the deploy folder): scripts/backup-offsite.sh
. "$(dirname "$0")/lib.sh"
REMOTE="${OFFSITE_REMOTE:-drive-crypt:}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
KEEP_OFFSITE_DAYS="${KEEP_OFFSITE_DAYS:-30}"
RCLONE_IMAGE="rclone/rclone:1.71"
mkdir -p backups rclone
name="nightly-$(date -u +%Y%m%d-%H%M%S)"
rclone() {
  docker run --rm -v "$PWD/rclone:/config/rclone" -v "$PWD/backups:/backups:ro" \
    ${OFFSITE_EXTRA_MOUNT:+-v "$OFFSITE_EXTRA_MOUNT"} "$RCLONE_IMAGE" "$@"
}

"$(dirname "$0")/backup-local.sh" "backups/$name"
rclone copy "/backups/$name" "$REMOTE$name" --transfers 2
# Prove it arrived, reading it back through the encryption, before calling it a success.
rclone check "/backups/$name" "$REMOTE$name" --one-way

rclone delete "$REMOTE" --min-age "${KEEP_OFFSITE_DAYS}d"
rclone rmdirs "$REMOTE" --leave-root
find backups -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_LOCAL_DAYS" -exec rm -rf {} +

storage="$(env_value STORAGE_HOST_DIR)"
touch "${storage:-./storage}/.offsite-backup-ok"
echo "[backup] $name is off the server"
