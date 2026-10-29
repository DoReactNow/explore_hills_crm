# Local Environment Setup Guide

This guide explains how to run Explore Hills CRM locally after cloning the repository: development database, isolated test database, dev server, background worker, tests, local Docker, and production Docker. Follow the steps in order.

> **Updated 2026-10-29** for Decisions 21–31: background worker (pg-boss), live updates, file storage drivers, browser-calling provider settings, Super Admin seed, and no fixed Docker IP addresses.

> **Rules used everywhere in this guide**
> - URLs use `127.0.0.1`, never `localhost`.
> - Ports are deliberately uncommon: **47213** (dev server), **47214** (Docker app), **47215** (E2E server), **54329** (Postgres).
> - Dev and test use **separate databases** (`explorehills_dev`, `explorehills_test`) and **separate env files** (`.env`, `.env.test`).
> - Development runs **two processes**: the web app (`npm run dev`) and the background worker (`npm run worker`).
> - Nothing external is needed locally: calling uses the `fake` provider, WhatsApp the `fake` gateway, and files the `local` storage driver (`storage/`, git-ignored).

---

## 1. Prerequisites

| Tool | Version | Check |
|:---|:---|:---|
| Docker Desktop (macOS/Windows) or Docker Engine + Compose plugin (Linux) | 24+ | `docker --version` and `docker compose version` |
| Node.js | 22.12 or newer (see `.nvmrc`; pg-boss needs 22.12+) | `node --version` |
| npm | 10+ | `npm --version` |
| Git | any recent | `git --version` |
| Database client (optional) | TablePlus or DBeaver | Connect to `127.0.0.1:54329` |

If you use `nvm`: `nvm install && nvm use` (reads `.nvmrc`).

---

## 2. Quick Start (fresh clone)

```bash
git clone <repository-url> explore-hills-crm
cd explore-hills-crm
npm ci

# 1. Env files (macOS / Linux / Git Bash)
cp .env.example .env
cp .env.test.example .env.test
# PowerShell: Copy-Item .env.example .env ; Copy-Item .env.test.example .env.test

# 2. Start Postgres (creates explorehills_dev, and explorehills_test via the init script)
npm run docker:db:up

# 3. Apply migrations and sync permissions/roles into the DEV database
npm run db:migrate:deploy
npm run db:sync-rbac

# 4. Real seed (first Super Admin) - from Phase 1 onwards, see Section 6 (skip in Phase 0: there are no user accounts yet)
mkdir -p prisma/private
cp prisma/seed.example.ts prisma/private/seed.ts     # set SEED_SUPER_ADMIN_* in .env
npm run db:seed

# 5. Prepare the TEST database (migrate + sync + test seed)
npm run db:test:prepare

# 6. Run the app and the worker (two terminals)
npm run dev        # http://127.0.0.1:47213
npm run worker     # background jobs; writes a heartbeat every few seconds
```

Health check: open `http://127.0.0.1:47213/api/health`. You should see `{"data":{"status":"ok", ...}}`. From Phase 1, signed in as the Super Admin, the diagnostics page shows the worker as `up`. In Phase 0 the integration tests check this with a test principal.

---

## 3. Environment Files

The three example files are committed. The dev and test examples already contain working defaults for the Docker database; copy them and you are ready.

### `.env.example` → `.env` (development)

```env
# Environment
APP_ENV="development"
APP_HOST="127.0.0.1"
APP_PORT="47213"
APP_URL="http://127.0.0.1:47213"
LOG_LEVEL="debug"

# Database - local Docker Postgres, DEV database
DATABASE_URL="postgresql://explorehills_user:explorehills_password@127.0.0.1:54329/explorehills_dev"

# Auth (used from Phase 1). Dev-only placeholder; the app refuses this value in production.
AUTH_SECRET="dev-only-secret-change-me-0123456789abcdef"

# Encrypts stored provider credentials (Decision 24). Dev-only placeholder; refused in production.
# Format: 32 random bytes, base64-encoded (AES-256-GCM key). This dev value is a valid placeholder; refused in production.
CREDENTIALS_ENCRYPTION_KEY="ZGV2LW9ubHkta2V5LWNoYW5nZS1tZS0wMDAwMDAwMDA="

# Integrations (Decisions 24, 26, 19). Local defaults need no external service.
TELEPHONY_PROVIDER="fake"
WHATSAPP_GATEWAY="fake"
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="./storage"

# Real seed (read by prisma/private/seed.ts): the first Super Admin. Set your own values; never commit them.
SEED_SUPER_ADMIN_EMAIL="superadmin@example.com"
SEED_SUPER_ADMIN_PASSWORD="change-me-before-seeding"
```

### `.env.test.example` → `.env.test` (tests only)

```env
# Environment
APP_ENV="test"
APP_HOST="127.0.0.1"
APP_PORT="47215"
APP_URL="http://127.0.0.1:47215"
LOG_LEVEL="silent"

# Database - local Docker Postgres, TEST database (must end in _test)
DATABASE_URL="postgresql://explorehills_user:explorehills_password@127.0.0.1:54329/explorehills_test"

AUTH_SECRET="test-only-secret-not-for-real-use-0123456789"
CREDENTIALS_ENCRYPTION_KEY="dGVzdC1vbmx5LWtleS1ub3QtZm9yLXJlYWwtdXNlLTA="

# Integrations: tests always use fakes and a separate storage folder
TELEPHONY_PROVIDER="fake"
WHATSAPP_GATEWAY="fake"
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="./storage/test"

# Throwaway credentials used ONLY by prisma/seed-test.ts and the tests.
# They exist only in the test database.
TEST_SUPER_ADMIN_EMAIL="superadmin.test@example.com"
TEST_SUPER_ADMIN_PASSWORD="Test-Only-SuperAdmin-Pass-1"
TEST_ADMIN_EMAIL="admin.test@example.com"
TEST_ADMIN_PASSWORD="Test-Only-Admin-Pass-1"
TEST_MANAGER_EMAIL="manager.test@example.com"
TEST_MANAGER_PASSWORD="Test-Only-Manager-Pass-1"
TEST_AGENT_EMAIL="agent.test@example.com"
TEST_AGENT_PASSWORD="Test-Only-Agent-Pass-1"
# Extra test agents use numbered emails (agent2.test@example.com, ...) with TEST_AGENT_PASSWORD.
```

### `.env.production.example` → `.env.production` (on the server only)

```env
APP_ENV="production"
APP_HOST="0.0.0.0"
APP_PORT="47213"
APP_URL="https://<your-domain>"
LOG_LEVEL="info"

# Managed Postgres connection string (must NOT end in _test)
DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>?sslmode=require"

# Generate each with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
AUTH_SECRET="<generate-a-real-secret>"
CREDENTIALS_ENCRYPTION_KEY="<generate-a-real-key: 32 random bytes, base64>"

# Calling provider and WhatsApp gateway (Decisions 30 and 19). "fake" is refused in production.
# Each real adapter adds its own variables, prefixed TELEPHONY_<KEY>_ or WHATSAPP_<KEY>_, documented in its folder.
TELEPHONY_PROVIDER="<provider-key>"
WHATSAPP_GATEWAY="<gateway-key>"

# File storage (Decisions 26 and 31). Option A: local disk volume on the server (needs off-server backups)
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="/app/storage"
# Option B: any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, or self-hosted Garage/SeaweedFS/MinIO on a VPS)
# STORAGE_DRIVER="s3"
# STORAGE_S3_ENDPOINT="https://<endpoint>"
# STORAGE_S3_REGION="<region-or-auto>"
# STORAGE_S3_BUCKET="<bucket>"
# STORAGE_S3_ACCESS_KEY_ID="<key-id>"
# STORAGE_S3_SECRET_ACCESS_KEY="<secret>"
# STORAGE_S3_FORCE_PATH_STYLE="true"   # usually true for self-hosted servers
```

> **Safety guards.** With `APP_ENV=test` the app, the test setup and `seed-test` refuse to run unless the database name ends in `_test`. With `APP_ENV=production` they refuse a name ending in `_test`. If you see a "refusing to run" message, your `DATABASE_URL` and `APP_ENV` do not match.

---

## 4. Databases in Docker

One Postgres container (`explorehills_local_db`) hosts both databases.

| Setting | Value |
|:---|:---|
| Container | `explorehills_local_db` |
| Image | `postgres:16-alpine` |
| User / password | `explorehills_user` / `explorehills_password` (local only) |
| Dev database | `explorehills_dev` |
| Test database | `explorehills_test` |
| Host port | `127.0.0.1:54329` → container `5432` |
| Timezone | `UTC` |
| Volume | `explorehills_local_pgdata` |

### Start the container
```bash
npm run docker:db:up
# same as: docker compose -f docker/docker-compose.local.yml up -d db
```

On the **first start with an empty volume**, `explorehills_dev` is created from `POSTGRES_DB` and `explorehills_test` is created by `docker/postgres/init/01-create-test-db.sql`.

### Create the DEV database directly
```bash
npm run docker:db:create:dev
# same as:
docker exec explorehills_local_db psql -U explorehills_user -d postgres -c "CREATE DATABASE explorehills_dev OWNER explorehills_user;"
```

### Create the TEST database directly
```bash
npm run docker:db:create:test
# same as:
docker exec explorehills_local_db psql -U explorehills_user -d postgres -c "CREATE DATABASE explorehills_test OWNER explorehills_user;"
```

Use these two when the volume already existed before the init script ran. An "already exists" message is harmless.

### Verify both exist
```bash
docker exec explorehills_local_db psql -U explorehills_user -d postgres -c "\l"
```

### `docker/docker-compose.local.yml`

```yaml
name: explorehills-local

services:
  db:
    image: postgres:16-alpine
    container_name: explorehills_local_db
    command: ["postgres", "-c", "timezone=UTC", "-c", "log_timezone=UTC"]
    environment:
      POSTGRES_USER: explorehills_user
      POSTGRES_PASSWORD: explorehills_password
      POSTGRES_DB: explorehills_dev
      TZ: UTC
      PGTZ: UTC
    ports:
      - "127.0.0.1:54329:5432"
    volumes:
      - explorehills_local_pgdata:/var/lib/postgresql/data
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U explorehills_user -d explorehills_dev"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped
    networks:
      - explorehills_local_net

  # Optional: the whole app (web + worker) inside Docker. Start with:  --profile app
  app:
    profiles: ["app"]
    build:
      context: ..
      dockerfile: docker/Dockerfile.local
    container_name: explorehills_local_app
    depends_on:
      db:
        condition: service_healthy
    environment:
      APP_ENV: development
      APP_HOST: 0.0.0.0
      APP_PORT: "47214"
      APP_URL: http://127.0.0.1:47214
      LOG_LEVEL: debug
      DATABASE_URL: postgresql://explorehills_user:explorehills_password@db:5432/explorehills_dev
      AUTH_SECRET: dev-only-secret-change-me-0123456789abcdef
      CREDENTIALS_ENCRYPTION_KEY: ZGV2LW9ubHkta2V5LWNoYW5nZS1tZS0wMDAwMDAwMDA=
      TELEPHONY_PROVIDER: fake
      WHATSAPP_GATEWAY: fake
      STORAGE_DRIVER: local
      STORAGE_LOCAL_DIR: /workspace/storage
      TZ: UTC
      WATCHPACK_POLLING: "true"
    ports:
      - "127.0.0.1:47214:47214"
    volumes:
      - ..:/workspace
      - explorehills_local_node_modules:/workspace/node_modules
      - explorehills_local_next_cache:/workspace/.next
    networks:
      - explorehills_local_net

  # Background worker (pg-boss). Same image and settings as the app, different command.
  worker:
    profiles: ["app"]
    build:
      context: ..
      dockerfile: docker/Dockerfile.local
    container_name: explorehills_local_worker
    command: ["npx", "tsx", "watch", "src/worker/index.ts"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      APP_ENV: development
      LOG_LEVEL: debug
      DATABASE_URL: postgresql://explorehills_user:explorehills_password@db:5432/explorehills_dev
      AUTH_SECRET: dev-only-secret-change-me-0123456789abcdef
      CREDENTIALS_ENCRYPTION_KEY: ZGV2LW9ubHkta2V5LWNoYW5nZS1tZS0wMDAwMDAwMDA=
      TELEPHONY_PROVIDER: fake
      WHATSAPP_GATEWAY: fake
      STORAGE_DRIVER: local
      STORAGE_LOCAL_DIR: /workspace/storage
      TZ: UTC
    volumes:
      - ..:/workspace
      - explorehills_local_node_modules:/workspace/node_modules
    networks:
      - explorehills_local_net

volumes:
  explorehills_local_pgdata:
  explorehills_local_node_modules:
  explorehills_local_next_cache:

# Containers reach each other by service name (for example "db"); no fixed IP addresses (Decision 29).
networks:
  explorehills_local_net:
    driver: bridge
```

### `docker/postgres/init/01-create-test-db.sql`
```sql
CREATE DATABASE explorehills_test OWNER explorehills_user;
```

---

## 5. Migrations

Every schema change is a committed Prisma migration. Never edit a migration that has been applied elsewhere.

```bash
# Create + apply a new migration in DEV after editing prisma/schema.prisma
npm run db:migrate:dev -- --name add_something_clear

# Apply existing migrations only (no new ones) to DEV
npm run db:migrate:deploy

# Apply existing migrations to the TEST database
npm run db:test:migrate

# Check that schema.prisma and the migration history agree (used by CI).
# Applies the migrations to the TEST database first, then diffs it against schema.prisma.
npm run db:migrate:check

# Regenerate the Prisma client after schema changes
npm run db:generate

# Wipe the DEV database and re-apply everything (DESTROYS DATA)
npm run db:reset:dev
```

Migrations must be backward compatible with the previous app version (add columns nullable or with defaults; drop or rename only after a release that stops using them). In CI the migrations are applied automatically before integration and E2E tests; in deployment they are applied before the new app version starts.

---

## 6. Seeding (three separate things)

| Command | What it does | Which database | Committed file |
|:---|:---|:---|:---|
| `npm run db:sync-rbac` | Syncs permissions, system roles and default bundles from the code registry. Safe and idempotent. | Any (dev, test, production) | `src/modules/identity/rbac/syncRbac.ts` |
| `npm run db:seed` | **Real seed**: the first Super Admin and real team, from your private file and `.env`. | Dev or production. **Refuses** a `_test` database. | **None.** Lives in `prisma/private/`, which is git-ignored. |
| `npm run db:seed:test` | **Test seed**: fake users and fixtures, credentials from `.env.test`. | **Test only.** Refuses any database not ending in `_test`. | `prisma/seed-test.ts` |

### Setting up the real seed
```bash
mkdir -p prisma/private
cp prisma/seed.example.ts prisma/private/seed.ts
```
Edit `prisma/private/seed.ts` if you need extra records, and set `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` in `.env`. The password must be at least 12 characters with three of lowercase, uppercase, digits and symbols, and no placeholder or common word; the `.env.example` value is refused on purpose (Decision 40). From Phase 1 (when user accounts exist) the seed creates the first Super Admin, and does nothing if an active Super Admin already exists. **Never commit this file or those values.** The whole `prisma/private/` folder is ignored by git, and CI fails if anything inside it is tracked.

`prisma migrate reset` does **not** run any seed automatically. Run the seed commands yourself.

**Roles after seeding:** `db:sync-rbac` creates the system roles `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `AGENT`. After that, the Super Admin changes permissions on the Roles & Permissions page. Re-running `db:sync-rbac` (every deploy does) never overwrites those edits; it only adds new permissions and missing system roles (Decision 23).

---

## 7. Running the App

```bash
npm run dev              # development server on http://127.0.0.1:47213 (hot reload)
npm run build            # production build (needs no database or secrets)
npm run start            # serve the production build using .env
npm run start:test       # serve the production build using .env.test on port 47215

npm run worker           # background worker for development (restarts on file changes)
npm run build:worker     # bundle the worker to dist/worker.js
npm run worker:start     # run the bundled worker (production style; env from the process)
```

The app and the worker are separate processes. Without the worker, the app still works, but timeouts, reminders, webhook processing and recording downloads wait until it runs. Live updates in the browser come from `GET /api/events/stream`.

The scripts call `scripts/run-next.mjs`, which reads `APP_HOST` and `APP_PORT` from the chosen env file, so the port is defined in one place.

---

## 8. Tests

Tests use `.env.test` and the `explorehills_test` database only. They never touch `explorehills_dev`.

```bash
npm run db:test:prepare     # migrate + RBAC sync + test seed (run automatically by the two commands below)

npm run test:unit           # pure logic, no database (includes the timezone matrix)
npm run test:integration    # route -> controller -> service -> repository -> real test DB
npm run test:e2e            # Playwright against the BUILT app on port 47215
npm run test                # unit, then integration, then e2e
npm run test:watch          # Vitest watch mode for unit tests
```

First E2E run only: `npx playwright install chromium`.

Tests never need the worker running: integration tests run queued jobs themselves with the `runPendingJobs()` helper, and use the `fake` calling provider, the `fake` WhatsApp gateway and the `local` storage driver (`storage/test`). From Phase 7, `npm run test:contract:s3` optionally runs the storage contract suite against a local S3-compatible container.

When tests start you should see the log line confirming `.env.test` was loaded. If you see a "refusing to run" message, `APP_ENV` and `DATABASE_URL` in `.env.test` disagree.

### Full CI suite locally
```bash
npm run ci:quality
```
Runs, in this exact order and stopping at the first failure:
`lint → typecheck → build → build:worker → test:unit → test:integration → test:e2e`.
The build always runs before the tests.

You can run any step alone: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`.

---

## 9. Docker: Local Full Stack (optional)

The default workflow is "database in Docker, app on your machine". To run the app in Docker as well:

```bash
npm run docker:local:up      # db + app + worker (docker compose --profile app up -d --build)
# App: http://127.0.0.1:47214
npm run docker:local:logs    # follow app and worker logs
npm run docker:local:down    # stop and remove containers (volumes are kept)
```

The Docker app uses `Dockerfile.local`: dev dependencies installed, source mounted into the container for hot reload, running `next dev` on `0.0.0.0:47214` inside the container but published only to `127.0.0.1` on your machine. Run migrations against the Docker database from your machine with the normal `npm run db:migrate:deploy`, or inside the container:

```bash
docker exec explorehills_local_app npm run db:migrate:deploy
```

Do not run `npm run dev` and the Docker app at the same time against the same database unless you intend to.

### Reset local Docker data
```bash
docker compose -f docker/docker-compose.local.yml down          # keep data
docker compose -f docker/docker-compose.local.yml down -v       # DESTROY data volumes (dev and test DBs)
```
After `down -v`, repeat Section 2 steps 2 to 5.

---

## 10. Docker: Production Build and Run

Production uses `docker/Dockerfile.prod` (multi-stage, Next.js `standalone` output, a separate `worker` target, non-root user, healthcheck, OpenSSL only in the Prisma CLI stages) and `docker/docker-compose.prod.yml`. The database is **external** (managed Postgres). The host must keep processes running (container host or VPS, not serverless), because the worker and live updates are long-running.

```bash
# On the server, with .env.production in place
docker compose --env-file .env.production -f docker/docker-compose.prod.yml build
docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d
```

Start order is enforced: the one-shot `migrate` service runs `prisma migrate deploy` first, and `app` and `worker` start only after it completes successfully. If migration fails, neither starts.

After the first deployment (once):
```bash
# idempotent permission and role sync (no secrets); also run on every deploy by the pipeline
docker compose --env-file .env.production -f docker/docker-compose.prod.yml run --rm migrate node dist/sync-rbac.js
```
The first Super Admin is created by an operator running the **private** real seed against production from a secure machine. It is never part of the repository or the pipeline.

### `docker/docker-compose.prod.yml`

```yaml
name: explorehills-prod

services:
  migrate:
    build:
      context: ..
      dockerfile: docker/Dockerfile.prod
      target: migrator
    env_file: ../.env.production
    command: ["npx", "prisma", "migrate", "deploy"]
    restart: "no"

  app:
    build:
      context: ..
      dockerfile: docker/Dockerfile.prod
      target: runner
    env_file: ../.env.production
    environment:
      HOSTNAME: 0.0.0.0                        # the standalone server.js reads HOSTNAME and PORT, not APP_HOST/APP_PORT
      PORT: ${APP_PORT:-47213}
    depends_on:
      migrate:
        condition: service_completed_successfully
    ports:
      - "127.0.0.1:${APP_PORT:-47213}:${APP_PORT:-47213}"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    read_only: true
    tmpfs:
      - /tmp
      - /app/.next/cache:uid=1000,gid=1000     # Next.js writes its cache here as the node user (uid 1000); the rest of the filesystem is read-only
    volumes:
      - explorehills_storage:/app/storage      # used only when STORAGE_DRIVER=local (the image creates /app/storage owned by the node user)
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped

  worker:
    build:
      context: ..
      dockerfile: docker/Dockerfile.prod
      target: worker
    env_file: ../.env.production
    command: ["node", "dist/worker.js"]
    depends_on:
      migrate:
        condition: service_completed_successfully
    read_only: true
    tmpfs:
      - /tmp                                   # recording download and compression scratch space
    volumes:
      - explorehills_storage:/app/storage      # used only when STORAGE_DRIVER=local
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped

volumes:
  explorehills_storage:
```

Put a reverse proxy (Caddy, nginx, or your host's load balancer) in front of `127.0.0.1:<APP_PORT>` to terminate HTTPS. HTTPS is required in production: browsers only allow microphone access (browser calling) on secure pages. Turn response buffering **off** for `/api/events/stream` (nginx: `proxy_buffering off;`), otherwise live updates arrive late or not at all.

With `STORAGE_DRIVER=local`, recordings live in the `explorehills_storage` volume on this server: set up a nightly off-server backup of that volume before go-live (Decision 26).

---

## 11. Command Reference

| Command | Purpose |
|:---|:---|
| `npm run dev` | Dev server (port 47213) |
| `npm run build` | Production build |
| `npm run start` / `start:test` | Serve the build with `.env` / `.env.test` |
| `npm run worker` | Development background worker (restarts on change) |
| `npm run build:worker` / `worker:start` | Bundle the worker / run the bundled worker |
| `npm run build:tools` | Bundle the production RBAC sync to `dist/sync-rbac.js` (used inside the migrator image) |
| `npm run storage:copy -- --from <driver> --to <driver>` | Copy every stored file between storage drivers (from Phase 7) |
| `npm run test:contract:s3` | Optional storage contract suite against a local S3-compatible container (from Phase 7) |
| `npm run lint` | ESLint + architecture boundaries + formatting check |
| `npm run lint:code` / `lint:arch` / `format:check` | The three lint parts separately |
| `npm run format` | Auto-format with Prettier |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run test:unit` / `test:integration` / `test:e2e` | One test tier |
| `npm run test` | All three tiers in order |
| `npm run ci:quality` | `lint → typecheck → build → build:worker → unit → integration → e2e` |
| `npm run guard:files` | Fails if secrets, real env files or `prisma/private/` are tracked by git |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate:dev -- --name x` | Create and apply a migration (dev) |
| `npm run db:migrate:deploy` | Apply migrations to the `.env` database |
| `npm run db:migrate:check` | Verify schema and migrations agree |
| `npm run db:test:migrate` | Apply migrations to the test database |
| `npm run db:test:prepare` | Test DB: migrate + RBAC sync + test seed |
| `npm run db:sync-rbac` | Sync permissions and system roles |
| `npm run db:seed` | Real seed (private file) |
| `npm run db:seed:test` | Test seed (test DB only) |
| `npm run db:reset:dev` / `db:reset:test` | Wipe and re-apply (destroys data) |
| `npm run docker:db:up` / `docker:db:down` | Start / stop the Postgres container |
| `npm run docker:db:create:dev` / `create:test` | Create a database directly |
| `npm run docker:local:up` / `logs` / `down` | Local full-stack Docker (db + app + worker) |
| `npm run docker:prod:build` / `docker:prod:up` | Production image build / run (needs `.env.production`) |

---

## 12. Troubleshooting

**Port already in use (54329 or 47213).** Another process owns it. Stop it, or change the port in one place: `APP_PORT` in the env file (web) or the host port in `docker/docker-compose.local.yml` plus `DATABASE_URL` (Postgres).

**`localhost` timeouts or connection resets.** Use `127.0.0.1` in every URL. The example files already do.

**"Refusing to run" from a seed or the test setup.** `APP_ENV` and the database name disagree (for example the test seed pointed at `explorehills_dev`). Check the env file that command is reading.

**`explorehills_test` does not exist.** The volume pre-dates the init script. Run `npm run docker:db:create:test`, then `npm run db:test:prepare`.

**Prisma client type errors after a schema change.** Run `npm run db:generate` and restart the TypeScript server in your editor.

**Migration drift reported by `db:migrate:check`.** You changed `schema.prisma` without creating a migration. Run `npm run db:migrate:dev -- --name <name>` and commit the new migration folder.

**E2E fails with "browser not found".** Run `npx playwright install chromium` once.

**E2E cannot connect.** Run `npm run build` first. E2E serves the built app on port 47215; make sure nothing else uses it.

**Tests pass locally but fail in CI (or the reverse).** CI uses the same scripts and the same `.env.test.example` defaults. Run `npm run ci:quality` locally to reproduce the exact sequence.

**Dates look one day off.** Do not format dates with `toLocale*` or JS `Date` methods. Use `src/shared/time/` (see `project_data.md` Section 6).

**Diagnostics shows the worker as `down`, or timeouts and reminders never happen.** The worker is not running. Start `npm run worker` (or the `worker` container) and check its log.

**Live updates do not arrive (lists only change after a refresh).** Check the browser network tab for `/api/events/stream`. Behind a reverse proxy, turn response buffering off for that path. If the stream cannot connect, pages fall back to polling every few seconds.

**The softphone cannot use the microphone.** Browsers allow the microphone only on secure pages: `https://`, or `http://127.0.0.1` locally. Check the browser's site permissions. With the `fake` provider no microphone is needed.

**"Refusing to run" mentioning `fake`.** Production (`APP_ENV=production`) refuses the `fake` calling provider and WhatsApp gateway. Set the real provider keys in `.env.production`.

**Recordings or uploads appear in git status.** They belong in `storage/`, which is git-ignored. Check `STORAGE_LOCAL_DIR` points inside `storage/`.
