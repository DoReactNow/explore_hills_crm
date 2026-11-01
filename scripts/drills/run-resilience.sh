#!/usr/bin/env bash
# Usage: scripts/drills/run-resilience.sh   (build first; scripts/load/prepare.sh fills the database)
set -euo pipefail
. scripts/load/env.sh
exec node scripts/drills/resilience-drill.mjs
