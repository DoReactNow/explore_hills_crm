#!/usr/bin/env bash
# Usage: scripts/send-test-email.sh person@example.com
. "$(dirname "$0")/lib.sh"
IMAGE_TAG=$(current_release) compose run --rm -T migrate node dist/send-test-email.js "${1:?give an address}"
