#!/usr/bin/env bash
# The whole deployment, on this machine, as production: HTTPS through Caddy, a real rollback to an older
# build on the newer schema, failed deploys, real SMTP to a mail catcher, and an encrypted off-server backup
# restored and compared (P12-DEPLOY-01 to -11). A temporary folder and containers, all removed afterwards.
# Usage: scripts/drills/deploy-rehearsal.sh <older git ref>
set -uo pipefail
repo=$(pwd)
OLD_REF="${1:?give an older git ref to roll back to}"
OLD=old NEW=new
work=$(mktemp -d /tmp/explorehills-rehearsal.XXXXXX)
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1${4:+: $4}"; else echo "FAIL $1: expected $3, got $2"; fail=1; fi; }
build() { # context tag
  for target in migrator:migrator runner:app worker:worker; do
    docker build -q -f "$1/docker/Dockerfile.prod" --target "${target%%:*}" -t "explorehills-${target##*:}:$2" "$1" > /dev/null || exit 1
  done
}
cleanup() {
  cd "$work" 2>/dev/null && docker compose --env-file .env.production -f docker-compose.server.yml --profile tools down -v > /dev/null 2>&1
  docker rm -f rehearsal-mail > /dev/null 2>&1
  docker run --rm -v "$work:/w" alpine rm -rf /w/storage /w/backups /w/restored /w/drive /w/rclone > /dev/null 2>&1
  git -C "$repo" worktree remove --force "$work/old-src" > /dev/null 2>&1
  rm -rf "$work"
  for image in app worker migrator; do
    docker images "explorehills-$image" --format '{{.Tag}}' | grep -E '^(old|new|badmigrate|badapp)$' | xargs -I{} docker rmi -f "explorehills-$image:{}" > /dev/null 2>&1
  done
}
trap cleanup EXIT

echo "     building both versions"
git -C "$repo" worktree add -q --detach "$work/old-src" "$OLD_REF" || exit 1
started=$SECONDS
build "$work/old-src" "$OLD"
build "$repo" "$NEW"
echo "     built in $((SECONDS - started)) s; worker image $(docker images explorehills-worker:new --format '{{.Size}}'), app $(docker images explorehills-app:new --format '{{.Size}}')"

cd "$work"
cp "$repo/docker/docker-compose.server.yml" "$repo/docker/Caddyfile" .
mkdir -p scripts storage rclone drive
cp "$repo"/scripts/server/*.sh "$repo"/scripts/ops/*.sh scripts/
chmod 777 storage

scripts/generate-env.sh .env.production > /dev/null
check "the env file is private" "$(stat -f %Lp .env.production 2>/dev/null || stat -c %a .env.production)" 600
check "a second generate refuses to overwrite" "$(scripts/generate-env.sh .env.production 2>/dev/null; echo $?)" 1
check "secrets were generated" "$(grep -cE '^(AUTH_SECRET|CREDENTIALS_ENCRYPTION_KEY|VAPID_PRIVATE_KEY|POSTGRES_PASSWORD)=.{20,}' .env.production)" 4
sed -i.bak -e 's#^APP_URL=.*#APP_URL=https://localhost:8443#' -e 's#^APP_DOMAIN=.*#APP_DOMAIN=localhost#' \
  -e 's#^ACME_EMAIL=.*#ACME_EMAIL=rehearsal@example.com#' -e 's#^EMAIL_FROM=.*#EMAIL_FROM=alerts@crm.explorehills.in#' \
  -e 's#^SMTP_URL=.*#SMTP_URL=smtp://rehearsal-mail:1025#' -e 's#^OFFSITE_BACKUP_EXPECTED=.*#OFFSITE_BACKUP_EXPECTED=true#' \
  -e 's#^SEED_SUPER_ADMIN_EMAIL=.*#SEED_SUPER_ADMIN_EMAIL=owner@example.com#' \
  -e 's#^SEED_SUPER_ADMIN_PASSWORD=.*#SEED_SUPER_ADMIN_PASSWORD=Rehearsal-Pass-4821!#' .env.production
rm .env.production.bak
printf 'HTTP_PORT=8080\nHTTPS_PORT=8443\n' >> .env.production

C() { docker compose --env-file .env.production -f docker-compose.server.yml "$@"; }
URL=https://localhost:8443
live() { curl -sk -o /dev/null -w '%{http_code}' "$URL/api/health"; }
tag_now() { cat releases/current; }
signin() {
  curl -sk -c "$work/jar" -o /dev/null -w '%{http_code}' -H "origin: $URL" -H 'content-type: application/json' \
    -d '{"email":"owner@example.com","password":"Rehearsal-Pass-4821!"}' "$URL/api/auth/sign-in"
}
me() { curl -sk -b "$work/jar" -o /dev/null -w '%{http_code}' "$URL/api/auth/me"; }

# --- First deploy of the older version, then an upgrade with migrations.
scripts/deploy.sh "$OLD" > deploy.log 2>&1
check "the older version deploys" "$?" 0 "$(tail -1 deploy.log | cut -c1-60)"
docker run -d --name rehearsal-mail --network explorehills_default axllent/mailpit:v1.27 > /dev/null
for _ in $(seq 1 20); do [ "$(live)" = 200 ] && break; sleep 2; done
check "HTTPS answers through Caddy" "$(live)" 200
started=$SECONDS
scripts/deploy.sh "$NEW" > deploy.log 2>&1
check "upgrading deploys, with new migrations" "$?" 0 "$((SECONDS - started)) s"
check "a backup was taken first" "$(ls backups | grep -c before-new)" 1
scripts/first-run.sh > first.log 2>&1
check "the first Super Admin is created from the server's secrets" "$?" 0
check "they can sign in over HTTPS" "$(signin)" 200
check "and stay signed in" "$(me)" 200
scripts/first-run.sh > first.log 2>&1
check "running that again changes nothing" "$?" 0
HTTP_CHECK_URL=http://localhost:8080 scripts/verify.sh "$URL" -k > verify.log 2>&1
check "the outside checks pass" "$?" 0
cat verify.log | grep -E '^(FAIL|     )' | cut -c1-100

# --- Live updates aren't buffered by the proxy (P12-DEPLOY-07).
stream_first=$(curl -sk -b "$work/jar" -N -m 3 -o /dev/null -w '%{time_starttransfer}' "$URL/api/events/stream")
check "live updates start at once through the proxy" "$(echo "$stream_first < 1.5" | bc)" 1 "$stream_first s"

# --- Real mail.
scripts/send-test-email.sh someone@example.com > mail.log 2>&1
check "the real mail channel sends over SMTP" "$?" 0
check "and the mail arrived" "$(docker exec rehearsal-mail wget -qO- http://127.0.0.1:8025/api/v1/messages | grep -c 'Explore Hills CRM: test email')" 1

# --- Rollback to the older build, on the newer schema (P12-DEPLOY-02, -03).
worker_before=$(C ps -q worker)
scripts/rollback.sh > rollback.log 2>&1
check "rollback works" "$?" 0
check "the older build answers on the newer database" "$(live)" 200
check "people can still sign in" "$(signin)" 200
check "the current version is recorded" "$(tag_now)" "$OLD"
scripts/deploy.sh "$NEW" > deploy.log 2>&1
check "going forward again works" "$?" 0
check "data survived both ways" "$(signin)" 200

# --- A failed migration (P12-DEPLOY-01).
docker build -q -t explorehills-migrator:badmigrate - > /dev/null <<'DOCKER'
FROM explorehills-migrator:new
USER root
RUN mkdir -p prisma/migrations/29990101000000_bad && echo 'SELECT nonsense FROM nowhere;' > prisma/migrations/29990101000000_bad/migration.sql
USER node
DOCKER
docker tag explorehills-app:new explorehills-app:badmigrate
docker tag explorehills-worker:new explorehills-worker:badmigrate
app_before=$(C ps -q app)
scripts/deploy.sh badmigrate > bad.log 2>&1
check "a failed migration stops the deploy" "$?" 1
check "the same app container keeps serving" "$(C ps -q app)" "$app_before"
check "and answers" "$(live)" 200
check "the version on record hasn't changed" "$(tag_now)" "$NEW"
# Clear the failed record so the database is usable, as the runbook describes.
IMAGE_TAG=new C run --rm -T migrate npx prisma migrate resolve --rolled-back 29990101000000_bad > /dev/null 2>&1 || \
  C exec -T db psql -q -U explorehills -d explorehills -c "DELETE FROM _prisma_migrations WHERE migration_name='29990101000000_bad'"

# --- A new version that won't start.
docker build -q -t explorehills-app:badapp - > /dev/null <<'DOCKER'
FROM explorehills-app:new
CMD ["node", "-e", "process.exit(1)"]
DOCKER
docker tag explorehills-migrator:new explorehills-migrator:badapp
docker tag explorehills-worker:new explorehills-worker:badapp
scripts/deploy.sh badapp > bad.log 2>&1
check "an unhealthy version stops the deploy" "$?" 1
sleep 10
for _ in 1 2 3 4 5 6 7 8 9 10; do [ "$(live)" = 200 ] && break; sleep 3; done
check "the previous version is put back" "$(live)" 200
check "the version on record hasn't changed" "$(tag_now)" "$NEW"

# --- The worker keeps running through an app deploy, and restarts cleanly (P12-DEPLOY-08).
worker_id=$(C ps -q worker)
IMAGE_TAG=new C up -d --no-deps --force-recreate app > /dev/null 2>&1
check "the worker isn't touched by an app change" "$(C ps -q worker)" "$worker_id"
stop_seconds=$SECONDS
IMAGE_TAG=new C stop worker > /dev/null 2>&1
check "the worker shuts down in good order" "$(docker inspect -f '{{.State.ExitCode}}' "$worker_id")" 0 "$((SECONDS - stop_seconds)) s"
IMAGE_TAG=new C up -d --no-deps worker > /dev/null 2>&1

# --- A leftover placeholder stops the start, clearly (P12-DEPLOY-06). Fake providers can't be chosen (-09).
cp .env.production env.good
sed -i.bak 's#^SMTP_URL=.*#SMTP_URL=<smtps://user:password@host:465>#' .env.production; rm .env.production.bak
out=$(IMAGE_TAG=new C run --rm -T --no-deps --entrypoint node worker dist/worker.js 2>&1 | grep -c 'SMTP_URL still holds')
check "a placeholder stops the worker starting, naming it" "$out" 1
cp env.good .env.production

cp .env.production env.good
sed -i.bak 's#^WHATSAPP_GATEWAY=.*#WHATSAPP_GATEWAY=fake#' .env.production; rm .env.production.bak
out=$(IMAGE_TAG=new C run --rm -T --no-deps --entrypoint node worker dist/worker.js 2>&1 | grep -c 'not allowed in production')
check "a fake provider stops the worker starting" "$out" 1
cp env.good .env.production

# --- Encrypted off-server backup, with a local folder standing in for Google Drive (P12-DEPLOY-10).
marker="REHEARSALMARK$RANDOM"
C exec -T db psql -q -U explorehills -d explorehills -c "INSERT INTO leads_contacts (id, \"phoneE164\", name, \"updatedAt\") VALUES (gen_random_uuid(), '+919800000001', '$marker', now())"
docker run --rm -u 0 -v "$work/storage:/s" alpine sh -c "mkdir -p /s/recordings/2026/11 && head -c 5000000 /dev/urandom > /s/recordings/2026/11/sample.mp3 && echo $marker >> /s/recordings/2026/11/sample.mp3 && chmod -R a+rX /s/recordings"
R() { docker run --rm -v "$work/rclone:/config/rclone" rclone/rclone:1.71 "$@"; }
pw1=$(openssl rand -hex 24); pw2=$(openssl rand -hex 24)
cat > rclone/rclone.conf <<CONF
[drive-crypt]
type = crypt
remote = /drive
password = $(R obscure "$pw1")
password2 = $(R obscure "$pw2")
CONF
export OFFSITE_EXTRA_MOUNT="$work/drive:/drive"
started=$SECONDS
scripts/backup-offsite.sh > offsite.log 2>&1
check "the nightly backup runs" "$?" 0 "$((SECONDS - started)) s"
tail -2 offsite.log | grep -i -E 'error|fail' | cut -c1-140
check "the success stamp is written" "$(ls -a storage | grep -c offsite-backup-ok)" 1
check "what leaves the server is encrypted" "$(docker run --rm -v "$work/drive:/d" alpine sh -c "grep -rl -e $marker /d | wc -l; " | tr -d ' ')" 0
check "file names are hidden too" "$(find drive | grep -cE 'nightly|database|files')" 0
name=$(scripts/restore-offsite.sh | awk '{print $NF}' | tail -1)
started=$SECONDS
scripts/restore-offsite.sh "$name" restored > restore.log 2>&1
check "it comes back from off-server, checksums matching" "$?" 0
C exec -T db psql -q -U explorehills -d postgres -c 'CREATE DATABASE restored'
pass=$(grep ^POSTGRES_PASSWORD= .env.production | cut -d= -f2)
PG_TOOLS="docker compose --env-file .env.production -f docker-compose.server.yml exec -T db" \
  RESTORE_DATABASE_URL="postgresql://explorehills:$pass@127.0.0.1:5432/restored" scripts/restore.sh restored "$work/restored/files" > restore2.log 2>&1
check "it restores into an empty database" "$?" 0 "$((SECONDS - started)) s from off-server to usable"
check "the customer is in the restored database" "$(C exec -T db psql -At -U explorehills -d restored -c "SELECT count(*) FROM leads_contacts WHERE name='$marker'")" 1
check "the recording came back intact" "$(cmp storage/recordings/2026/11/sample.mp3 restored/files/recordings/2026/11/sample.mp3 && echo same)" same

# --- Old off-server copies expire (Decision 69).
docker run --rm -v "$work/drive:/d" alpine sh -c 'find /d -type f -exec touch -d "2020-01-01" {} +'
R --version > /dev/null
scripts/backup-offsite.sh > offsite2.log 2>&1
check "expired copies are removed from off-server" "$(scripts/restore-offsite.sh | wc -l | tr -d ' ')" 1

# --- Restarting the whole server.
C restart > /dev/null 2>&1
for _ in $(seq 1 40); do [ "$(live)" = 200 ] && break; sleep 3; done
check "everything returns after a restart" "$(live)" 200
check "signed-in people stay signed in" "$(me)" 200
errors=$(C logs worker app 2>&1 | grep -E '"level":"(error|fatal)"' | grep -vcE 'telephony|whatsapp|terminating connection|Unknown' )
echo "     other errors logged: $errors"
C logs worker app 2>&1 | grep -E '"level":"(error|fatal)"' | cut -c1-200 | sed -E 's/"time":"[^"]*",//' | sort | uniq -c | sort -rn | head -5

[ "$fail" = 0 ] && echo "rehearsal passed" || echo "REHEARSAL FAILED"
exit "$fail"
