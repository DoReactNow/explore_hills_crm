#!/usr/bin/env bash
# Recreates the throwaway load database and fills it. Touches nothing but explorehills_load.
set -euo pipefail
. scripts/load/env.sh
psql_admin() { docker exec explorehills_local_db psql -q -U explorehills_user -d postgres "$@"; }
psql_admin -c 'DROP DATABASE IF EXISTS explorehills_load WITH (FORCE)'
psql_admin -c 'CREATE DATABASE explorehills_load'
npx prisma migrate deploy | tail -1
NODE_ENV=development npx tsx scripts/load/seed.ts
