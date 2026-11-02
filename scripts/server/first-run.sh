#!/usr/bin/env bash
# Once, after the first deploy: default settings, stages and the first Super Admin (P12-DEPLOY-05). Safe to
# repeat: it changes nothing when an active Super Admin exists.
. "$(dirname "$0")/lib.sh"
tag=$(current_release)
IMAGE_TAG="$tag" compose run --rm -T migrate node dist/first-super-admin.js
echo "Now remove SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD from $ENV_FILE."
