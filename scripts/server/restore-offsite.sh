#!/usr/bin/env bash
# Brings a backup back from Google Drive into a local folder and checks it. Restoring it is a separate,
# deliberate step: scripts/restore.sh refuses a non-empty target.
# Usage: scripts/restore-offsite.sh            lists what's there
#        scripts/restore-offsite.sh <name> <new local folder>
. "$(dirname "$0")/lib.sh"
REMOTE="${OFFSITE_REMOTE:-drive-crypt:}"
RCLONE_IMAGE="rclone/rclone:1.71"
if [ $# -eq 0 ]; then
  docker run --rm -v "$PWD/rclone:/config/rclone" ${OFFSITE_EXTRA_MOUNT:+-v "$OFFSITE_EXTRA_MOUNT"} "$RCLONE_IMAGE" lsd "$REMOTE"
  exit 0
fi
name="$1"
target="$2"
if [ -e "$target" ]; then echo "Refusing: $target already exists" >&2; exit 1; fi
mkdir -p "$target"
target=$(cd "$target" && pwd)
docker run --rm -v "$PWD/rclone:/config/rclone" -v "$target:/restore" ${OFFSITE_EXTRA_MOUNT:+-v "$OFFSITE_EXTRA_MOUNT"} \
  "$RCLONE_IMAGE" copy "$REMOTE$name" /restore
(cd "$target" && { sha256sum --check --quiet checksums.sha256 2>/dev/null || shasum -a 256 --check --quiet checksums.sha256; })
echo "[restore] $name is in $target, and its checksums match"
