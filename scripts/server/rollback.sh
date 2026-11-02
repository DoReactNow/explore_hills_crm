#!/usr/bin/env bash
# Goes back to the version before this one. The database stays as it is, which is safe because migrations
# must work with the previous version (Decision 69). To undo data, restore a backup instead (runbook).
. "$(dirname "$0")/lib.sh"
target=$(previous_release)
current=$(current_release)
if [ -z "$target" ]; then echo "There is no previous version to go back to" >&2; exit 1; fi
IMAGE_TAG="$target" compose up -d --no-deps app
wait_for_app || { echo "[rollback] version $target is not healthy" >&2; exit 1; }
IMAGE_TAG="$target" compose up -d --no-deps worker
echo "$current" > releases/previous
echo "$target" > releases/current
echo "[rollback] version $target is live; $current is kept"
