#!/usr/bin/env bash
# Creates .env.production on the server with fresh secrets and push keys, readable only by its owner.
# Leaves clearly marked what only the owner can supply. Refuses to overwrite an existing file.
set -euo pipefail
target="${1:-.env.production}"
if [ -e "$target" ]; then echo "Refusing: $target already exists" >&2; exit 1; fi
secret() { docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
vapid=$(docker run --rm node:22-alpine sh -c "cd /tmp && npm i --silent --no-audit --no-fund web-push@3 >/dev/null 2>&1 && npx web-push generate-vapid-keys --json")
field() { echo "$vapid" | docker run --rm -i node:22-alpine node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).$1))"; }
db_password=$(docker run --rm node:22-alpine node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
umask 077
cat > "$target" <<ENV
APP_ENV=production
APP_HOST=0.0.0.0
APP_PORT=47213
APP_URL=https://crm.explorehills.in
APP_DOMAIN=crm.explorehills.in
LOG_LEVEL=info
TRUSTED_PROXY_HOPS=1

POSTGRES_USER=explorehills
POSTGRES_PASSWORD=$db_password
POSTGRES_DB=explorehills
DATABASE_URL=postgresql://explorehills:$db_password@db:5432/explorehills
DATABASE_POOL_MAX=10

AUTH_SECRET=$(secret)
CREDENTIALS_ENCRYPTION_KEY=$(secret)

STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/app/storage
STORAGE_HOST_DIR=./storage

PUSH_DRIVER=webpush
VAPID_PUBLIC_KEY=$(field publicKey)
VAPID_PRIVATE_KEY=$(field privateKey)

# Set to true once the first off-server backup has run.
OFFSITE_BACKUP_EXPECTED=false

# From the owner. The app refuses to start while any of these still starts with "<".
ACME_EMAIL=<address for certificate notices>
EMAIL_DRIVER=smtp
EMAIL_FROM=<sender in Zoho, such as alerts@crm.explorehills.in>
SMTP_URL=<smtps://user:app-password@smtp.zoho.in:465, percent-encoding special characters>
# "none" starts the app with WhatsApp and calling not working, for checking the server only.
TELEPHONY_PROVIDER=none
WHATSAPP_GATEWAY=none

# Only for the first Super Admin. Remove both after scripts/first-run.sh.
SEED_SUPER_ADMIN_EMAIL=<owner's sign-in email>
SEED_SUPER_ADMIN_PASSWORD=<a strong password, kept in the owner's password manager>
ENV
echo "Wrote $target. Fill in the lines starting with <."
