# Release Tracker

Internal tool for tracking release candidates from identification through deployment.

- **Frontend:** React + TypeScript + Vite (installable PWA), Tailwind CSS + shadcn/ui, TanStack Query, React Router
- **Backend:** Node.js + Express API (`server/`), PostgreSQL 17
- **Runs as:** two containers (Postgres + one Node app), or locally with hot reload

## Quick start (just run the app)

You only need **Docker** (Docker Desktop, Rancher Desktop or Podman Desktop), **running**. No Node, no npm.

1. Start your Docker app and wait until it says it's running (`docker info` should not error).
2. In this folder:

   ```bash
   docker compose up -d --build
   ```

3. Open **http://localhost:8800** and sign in with `charbel@example.com` / `password123`, or create an account.

The demo has two projects: *Release Tracker* (sprints, full workflow) and *Mobile App* (no sprints, HIT only, no approval; `omar@example.com` is a viewer there). All demo users use `password123`.

Stop with `docker compose down` (data is kept); `docker compose down -v` deletes all data.

**"Cannot connect to the Docker daemon / Is the docker daemon running?"** means the Docker app isn't started yet. Open it, wait for it to finish starting, and run the command again.

### What runs

| Container | What it is |
| --- | --- |
| `db` | PostgreSQL 17 (`postgres:17-alpine`), data in the `pgdata` volume |
| `migrate` | one-shot: applies `server/db/migrations`, loads the demo data once (`SEED=true`), exits |
| `app` | Express API + the built web app on **http://localhost:8800** |

Ports are bound to `127.0.0.1` only: app `8800` (`APP_PORT`), Postgres `54329` (`DB_PORT`, user `postgres`).

**Secrets.** The defaults in `docker-compose.yml` are for local use only. For anything shared, put your own `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` and `ENCRYPTION_KEY` (32+ random characters) in a `.env` file next to `docker-compose.yml` **before the first start** (changing database passwords later requires `docker compose down -v`).

### Install on another computer

1. Install a Docker runtime: Docker Desktop (needs a paid licence at larger companies), or free alternatives such as **Rancher Desktop** (choose the *dockerd/moby* engine) or **Podman Desktop** (with Docker compatibility).
2. Copy this folder (a zip of the repo is enough; no `node_modules` needed) and open a terminal in it.
3. Run `docker compose up -d --build` and open http://localhost:8800. The first run downloads the base images (~150 MB) and npm packages; later starts work offline.

**Without internet on the target machine**: build an image bundle on a machine that has internet (and this repo), then copy it along with the project folder:

```bash
scripts/build-offline-bundle.sh amd64   # Windows PCs and Intel Macs
scripts/build-offline-bundle.sh arm64   # Apple-silicon Macs (M1 and later)
```

On the target machine, inside the project folder:

```bash
docker load -i release-tracker-images-amd64.tar.gz   # or -arm64
docker compose up -d                                  # no --build: uses the loaded images
```

Load **only the bundle matching the machine's CPU** (loading the other one re-points the image names to that architecture). Windows: run the commands in PowerShell from the unzipped folder; if a port is taken, e.g. `$env:APP_PORT=8900; docker compose up -d --build`.

## Developing (code changes with hot reload)

Prerequisites: Node 22+, Docker running.

```bash
npm install
cp .env.example .env            # dev database settings
docker compose up -d db         # just Postgres, on 127.0.0.1:54329
npm run db:migrate              # schema + demo data
npm run dev:server              # API on :3000 (restarts on change)
npm run dev                     # web app on http://localhost:5173 (proxies /api to :3000)
```

| Script | What it does |
| --- | --- |
| `npm run dev` / `dev:server` | Vite dev server / API with auto-restart |
| `npm run build` | Type-check and build the web app (`dist/`) and the server (`dist-server/`) |
| `npm start` | Run the built server (serves `dist/` when `STATIC_DIR` is set) |
| `npm run typecheck` / `lint` | TypeScript (app + server) / oxlint |
| `npm test` | Frontend unit tests (Vitest) |
| `npm run test:api` | API tests against a real Postgres (see *Testing*) |
| `npm run smoke` | The same API tests against a running deployment (`API_BASE_URL`) |
| `npm run db:migrate` | Apply migrations (+ demo data when `SEED=true`) using `.env` |

## Architecture

```
server/
  index.ts, app.ts       Express app: security headers, CSRF guard, auth, routes, static files
  routes/                auth, projects (members, invitations), releases (sprints, steps, reports, approvals, search)
  realtime.ts            live updates: Postgres LISTEN/NOTIFY → Server-Sent Events
  auth/                  scrypt passwords, cookie sessions
  db/migrations/         SQL schema (tables, triggers, RLS, membership functions)
  db/seed.sql            demo data
src/
  components/ features/ pages/   the web app (feature folders: api.ts = API calls, queries.ts = TanStack hooks)
  lib/                   framework-free logic (status, workflow, calendar, permissions) with unit tests
```

**Database access model.** The API connects as a restricted Postgres login (`release_tracker_app`) and sets `app.user_id` for every request transaction. Row level security decides what each user can read and write, so a bug in a route can't leak another project's data. That login cannot read password hashes or sessions, nor write memberships; those go through security-definer SQL functions. Only the migration step uses the owner login.

**Auth.** Email + password (scrypt, OWASP cost), opaque session tokens stored as SHA-256, `HttpOnly; SameSite=Lax` cookie (`COOKIE_SECURE=true` behind HTTPS). Sign-in/up are rate-limited; state-changing requests need the `X-Requested-With: release-tracker` header and a same-origin `Origin` (CSRF). The server sends a strict CSP and other security headers.

**API** (all under `/api`, JSON, session cookie):

| | |
| --- | --- |
| `POST /auth/signup` `/auth/login` `/auth/logout`, `GET /auth/me` | accounts and sessions |
| `GET/POST /projects`, `PATCH/DELETE /projects/:id` | projects (create makes you owner) |
| `GET /projects/:id/members`, `PUT/DELETE /projects/:id/members/:userId` | roles, remove/leave |
| `GET /projects/:id/invitations`, `POST …/invitations/email` `…/invitations/link`, `DELETE /invitations/:id` | invitations |
| `GET /invites/:token`, `POST /invites/:token/accept` | invite links |
| `GET /projects/:id/sprints`, `GET/PATCH/DELETE /sprints/:id`, `POST /sprints` | sprints |
| `GET /releases?projectId&sprintId&open&deploymentFrom&deploymentTo`, `POST /releases` | releases (with steps and reports) |
| `GET/PATCH/DELETE /releases/:id`, `GET /releases/:id/activity`, `GET /releases/:id/events` (SSE) | one release |
| `PATCH /tasks/:id` `/reports/:id` `/approvals/:id` | workflow edits |
| `GET /search?q=`, `GET /users`, `PATCH /me` | search, people, your name |

## Projects, roles and invitations

Everything lives in a **project** (switcher at the top of the sidebar). Each project has its own sprints, releases, calendar, dashboard and settings (**Settings → Project**):

- **Sprints on/off.** Without sprints, releases belong directly to the project and the dashboard shows open + recently deployed releases.
- **Workflow:** which steps are used, which reports (Load Test / Longevity / HIT) are reviewed, and whether approval is required. Changes apply to releases created afterwards.

| Role | Can |
| --- | --- |
| Viewer | read everything in the project |
| Member | + create/edit sprints, releases, steps, reports, approvals |
| Admin | + project settings, invite and remove members, delete sprints/releases |
| Owner | + delete the project, manage owners (a project always keeps one) |

Invite from **Settings → Project → Invite people** (admins and owners):
- **By email**: existing users are added immediately; others join automatically when they sign up.
- **By link**: a role and an expiry (1–30 days). Anyone who opens it joins after signing in, or after creating an account (they're brought back to the invite). Only a SHA-256 hash is stored; revoke anytime.

Roles are enforced by Postgres (RLS + the membership functions in `server/db/migrations/0001_baseline.sql`); the UI only hides what you can't do.

## Testing

```bash
npm test                                   # frontend unit tests

# API tests: creates a fresh `release_tracker_test` database on any Postgres you own
docker compose up -d db
TEST_DATABASE_ADMIN_URL=postgres://postgres:release-tracker-local-owner-password@127.0.0.1:54329/postgres npm run test:api

# Same suite against a running deployment (creates throwaway projects/users)
API_BASE_URL=http://localhost:8800 npm run smoke
```

## Conventions

- **Dates.** Calendar days (planned dates, sprint bounds, target deployment) are Postgres `date`, sent as `"YYYY-MM-DD"` strings and handled via `src/lib/dates.ts`. Points in time (`completed_at`, `reviewed_at`, audit columns) are `timestamptz`, shown in the viewer's timezone.
- **Workflow creation.** Inserting a release runs a DB trigger that creates the project's enabled steps, reports and approval. The step list is mirrored in `src/lib/workflow.ts`.
- **Overall status** is computed client-side from steps, reports and today's date. Only an optional manual `status_override` is stored.
- **Activity log** is written by DB triggers on releases, steps, reports and approvals, plus membership events.
- **Status, next action, action items, calendar events** are pure functions in `src/lib/` (`release-status.ts`, `action-items.ts`, `calendar-events.ts`) with unit tests. Change the rules there.
- **Keyboard:** `⌘K` search & commands, `c` new release, `?` shortcuts, `g d / g s / g r / g c / g ,` navigation, `⌘B` toggle sidebar.
