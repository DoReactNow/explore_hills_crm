# Operations Runbook: Explore Hills CRM

How to set up, run and recover production. Decision 69 explains the choices. Everything lives in `/opt/explorehills` on the VPS, and commands run from there as the `deploy` user.

**Tested by rehearsal only:** `scripts/drills/deploy-rehearsal.sh` runs all of this on a Mac in production mode, except where noted. None of it has run on the real VPS, against real Let's Encrypt, Zoho or Google Drive yet.

## First setup

1. **VPS.** Ubuntu 24.04 on Hostinger, with at least 4 GB of memory, since the app, worker and database share it. Make an SSH key for deploys, then as root run `bash setup-vps.sh "<public key>"`. Confirm `ssh deploy@<address>` works in a new window before closing the old one, because this turns password sign-in off.
2. **DNS.** At GoDaddy, add one record: `A`, name `crm`, pointing to the VPS. Change nothing else. `explorehills.in` must keep its A, MX and TXT records.
3. **Secrets.** Copy the `scripts/` folder over, then run `scripts/generate-env.sh`. It creates `.env.production` with fresh secrets and push keys. Fill in the lines starting with `<`. The app refuses to start while any remain.
4. **GitHub.** In the `production` environment add `VPS_HOST`, `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`. Setting the variable `DEPLOY_ENABLED=true` means every merge to `main` deploys.
5. **First deploy,** then `scripts/first-run.sh` once. Remove the `SEED_SUPER_ADMIN_*` lines afterwards.
6. **Check it:** `scripts/verify.sh https://crm.explorehills.in`, then try the microphone in a browser (needs real HTTPS; not covered by the rehearsal).
7. **Mail:** see below, then `scripts/send-test-email.sh you@example.com`.
8. **Backups:** see below.
9. **Outside monitoring:** add `https://crm.explorehills.in/api/health` to an uptime service, with certificate checks if it offers them.
10. **Review who has access:** who holds Admin, `privacy:*` and `audit:*`, and who has SSH.

## Mail (Zoho)

Don't touch the MX records or the `explorehills.in` SPF record: existing mail runs through GoDaddy, and that SPF ends in `-all`.

- In Zoho, add `crm.explorehills.in` as the sending domain, and create a mailbox such as `alerts@crm.explorehills.in`.
- At GoDaddy add only what Zoho shows for the name `crm`: its verification record, SPF (`v=spf1 include:zoho.in -all` on `crm`) and DKIM (`<selector>._domainkey.crm`).
- `SMTP_URL=smtps://alerts%40crm.explorehills.in:<app password>@smtp.zoho.in:465`. Use `smtp.zoho.com` if the Zoho account isn't in India's data centre. Percent-encode special characters.
- If Zoho insists on MX records for the name, they go on `crm` only, never on the root.

## Off-server backups (Google Drive)

On your own computer: `rclone authorize drive`, then paste the token into `rclone/rclone.conf` on the VPS:

```
[drive]
type = drive
scope = drive.file
token = <from rclone authorize>

[drive-crypt]
type = crypt
remote = drive:explorehills-backups
password = <from: rclone obscure "long random password">
password2 = <from: rclone obscure "another long random password">
```

**Keep both passwords and a copy of `.env.production` in a password manager, not on the VPS.** If the VPS is lost, the backups can't be read without the passwords, and data encrypted by the app can't be read without `CREDENTIALS_ENCRYPTION_KEY` from `.env.production`.

Then run `scripts/backup-offsite.sh` once and set `OFFSITE_BACKUP_EXPECTED=true`. Cron runs it at 02:30 nightly. Copies expire after 30 days off-server and 7 on the VPS. A gap over 36 hours raises an alert.

The rehearsal used a local folder in place of Google Drive, so the real connection, its upload speed and Google's limits are untested.

## Everyday

| Task | Command |
|:---|:---|
| Deploy | Merge to `main` once enabled, or `scripts/deploy.sh <tag>` |
| Go back one version | `scripts/rollback.sh` |
| See status | `docker compose --env-file .env.production -f docker-compose.server.yml ps`, and the Diagnostics screen |
| Read logs | The same command with `logs --tail=100 app` (or `worker`, `caddy`, `db`) |
| Forgotten Super Admin password | `RESET_SUPER_ADMIN_*` set, then `compose run --rm migrate node dist/reset-super-admin-password.js` |

## When things go wrong

- **A deploy failed at the migration.** The old version keeps running. If the log shows a failed migration, fix it, then clear its record with `compose run --rm migrate npx prisma migrate resolve --rolled-back <name>` and deploy again.
- **A deploy failed its health check.** The previous version is put back automatically. Read `compose logs app`.
- **A release is bad.** `scripts/rollback.sh`. The database stays as it is. Data damage needs a restore.
- **Disk nearly full.** The alert names what's free. Check `backups/`, then `docker system df`. Recordings expire by the retention setting.
- **Certificate alert.** Caddy normally renews by itself. Read `compose logs caddy`, and check the `crm` record still points here and ports 80 and 443 are open.
- **Restoring.**
  1. `scripts/restore-offsite.sh` lists the backups, and `scripts/restore-offsite.sh <name> <new folder>` fetches and checks one.
  2. Stop the app and worker. Create an empty database, and use an empty storage folder.
  3. `RESTORE_DATABASE_URL=... PG_TOOLS="docker compose --env-file .env.production -f docker-compose.server.yml exec -T db" scripts/restore.sh <folder> <empty storage folder>`. It refuses a non-empty target or a damaged backup.
  4. Point `DATABASE_URL` and `POSTGRES_DB` at it, and start again.
  5. **Erase again every customer erased since that backup,** from `contact.erased` events in the audit trail (Decision 66).
- **Lost the VPS.** New VPS, steps 1 to 4 above with the saved `.env.production` instead of generating one, restore, repoint DNS.

## When the providers are chosen

Set `WHATSAPP_GATEWAY` and `TELEPHONY_PROVIDER` once their adapters exist, and register the webhook addresses with each provider: `https://crm.explorehills.in/api/webhooks/whatsapp`, `/api/webhooks/telephony` and `/api/webhooks/telephony/inbound`. Send a test message and call to confirm (`P12-DEPLOY-12`).
