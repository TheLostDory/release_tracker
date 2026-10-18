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
  routes/                auth, projects (members, invitations), releases (sprints, steps, reports, approvals, search), integrations
  integrations/          Jira + Jenkins clients, encrypted credentials, Jenkins poller
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
| `GET /projects/:id/integrations`, `PUT/DELETE …/integrations/{jira,jenkins}`, `POST …/test` | connections (admins) |
| `GET /projects/:id/jira/versions`, `POST /projects/:id/jira/import`, `PUT /releases/:id/jira`, `GET /releases/:id/jira/issues` | Jira |
| `GET/POST /releases/:id/jenkins`, `POST /releases/:id/jenkins/sync`, `DELETE /jenkins/jobs/:id`, `GET …/builds`, `POST …/run` | Jenkins |
| `GET/POST /releases/:id/jenkins/followed`, `POST /jenkins/followed/:id/refresh`, `DELETE /jenkins/followed/:id` | Followed Jenkins builds |
| `GET/PUT /releases/:id/code-refs`, `GET /releases/:id/code-compare` | RC (GitHub) vs Jira version |

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

## Jira and Jenkins

Connect per project in **Settings → Project → Integrations** (admins and owners). Saving tests the connection first. Tokens are encrypted with `ENCRYPTION_KEY` (AES-256-GCM) and never sent back to the browser. The API's database login can't even read them; changing `ENCRYPTION_KEY` means re-entering them.

| | Jira Cloud | Jira Server / Data Center | Jenkins |
| --- | --- | --- | --- |
| URL | `https://yourcompany.atlassian.net` | your Jira's base URL | your Jenkins' base URL |
| Credentials | account email + API token (id.atlassian.com → Security → API tokens) | personal access token (profile → Personal Access Tokens) | user + API token (user → Security → API Token) |
| Also | Jira project key (e.g. `ABC`) | Jira project key | — |

**Jira**
- **Releases → Import from Jira**: pick versions; each becomes a release (name/version from Jira, target from its release date).
- **Release page → Jira**: link a version (or unlink); see its issues (key, type, status, priority, assignee) with done / in progress / to do counts. Cached for a minute; ↻ refreshes.

**Jenkins** (release page → Jenkins → *Link job*: job path like `folder/job` or the job's URL, a purpose, optional `KEY=value` build parameters where `{{version}}` / `{{name}}` are filled in):

| Purpose | Effect |
| --- | --- |
| Automated jobs | latest builds of all such jobs drive the *Automated jobs* step: all passing → completed, any failing → blocked (with job and build), running → in progress |
| Load Test / Longevity / HIT report | a successful build's first HTML artifact (or the build page) becomes that report's link; the PASS/FAIL review stays with people |
| Other | shown with its builds only |

Each job shows its latest build and history and has a **Run** button (members+). The server checks linked jobs of undeployed releases **every 2 minutes**, plus *Sync now*. Changes appear in the activity log as *Jenkins*.

**Automated jobs step** (release page → Workflow steps → *Automated jobs*).
There's one slot each for **Load Test**, **Longevity** and **HIT** (the report
types the project uses), plus *Add another job*. Paste the link of each
running Jenkins job. Each one shows:
- its status, progress, and roughly how much time is left (Jenkins' own
  estimate, or how far past it the job is running);
- the builds it started.

The runs drive the step:
- every run passed → completed;
- any failure → blocked, with the reason;
- anything running → in progress.

A passing Load Test, Longevity or HIT run also fills that report's link (its
HTML report, if it has one). Pasting a new run into a slot replaces the old
one, e.g. after a re-run. The server re-checks running jobs every 2 minutes,
so the step updates even when nobody has the page open. Finished runs appear
in the activity log.

**Followed builds** (release page → Jenkins → *Follow a build*). Paste the
link of a specific run: a classic or Blue Ocean build link, or a job link,
which follows that job's latest run. The page shows the run's status, plus
every build it started, nested, with each one's own status:
- Pipeline `build` steps;
- the Parameterized Trigger and MultiJob plugins;
- otherwise, the "Starting building…" lines of the console log.

The status refreshes every 15 seconds while anything is running. Followed
builds are display only and don't change the workflow.

**Company certificates** (`SELF_SIGNED_CERT_IN_CHAIN`, "certificate this server doesn't trust"): many companies sign internal sites with their own certificate authority. Your Mac trusts it; the app's container doesn't. Paste the company root certificate into **Company HTTPS certificate** in the connection form. It's trusted only for that connection, and normal verification stays on. To get it on a Mac:

- **Keychain Access** → *System* keychain → *Certificates* → your company's root CA → *File → Export Items…* → format *Privacy Enhanced Mail (.pem)* → open the file in TextEdit and copy everything. Or ask IT for the "root CA certificate in PEM format".
- **Or, in Terminal** (while on the company network), copy the certificate chain the server presents to the clipboard:

  ```bash
  openssl s_client -showcerts -connect jira.yourcompany.com:443 -servername jira.yourcompany.com </dev/null 2>/dev/null \
    | awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' | pbcopy
  ```

**Network:** the app container calls Jira/Jenkins directly, so your machine must be able to reach them (e.g. be on the company VPN). Redirects aren't followed (credentials are never re-sent to another host), so use the final URL.

## Code vs Jira (GitHub)

Answers the question "is what we merged into the RC what Jira says is in the
release?".

**Connect:** Settings → Project → Integrations → GitHub. Enter:
- `https://github.com`, or your GitHub Enterprise address;
- a token with read access to contents and pull requests;
- the repositories;
- the RC branch pattern (default `release/{{version}}`).

**Compare:** on a release linked to a Jira version, open Jira → **Compare with
code**. For each repository, pick the release candidate branch or tag, and
what it is compared with. The previous release's RC is suggested. The page
reads every commit in the RC that isn't in the previous one, and the pull
requests they came from. It then picks out Jira keys from:
- pull request titles;
- branch names: the `<name>/<jira id>` convention, as in
  `Merge pull request #45 from jdoe/ABC-77`; a key at the start of any part
  of the branch name matches in any case, from any Jira project;
- commit messages.

It shows four lists:

| List | Meaning |
|---|---|
| In Jira, not merged | in the Jira version, but nothing merged mentions it (issues marked Done first) |
| Merged, not in this version | merged changes mention it, but its fix version is another one (or none, or it doesn't exist) |
| Merged without an issue | pull requests and branch merges that mention no issue |
| In both | matched, with the pull requests |

Merges of `main` or other release branches are set apart. So are the
individual commits inside pull requests. Results are cached for 2 minutes;
*Refresh* reads GitHub and Jira again.

## AI assistant ("Ask")

An **Ask** button in the top bar opens a chat about the current project, e.g.
"Which version was ABC-123 released in?", "What's in 2.4.0?", "Which releases are
blocked?". It stays hidden until the server is configured.

How it answers: for each question the server collects the data itself, as the
asking user, so people only get answers about projects they belong to:

- every release in the tracker (dates, steps, blockers, reports, approval);
- the Jira versions named in the question (or the next and the latest release),
  with their issues;
- issue keys in the question → their fix versions;
- other questions → Jira's own text search (with fix versions);
- linked Jenkins jobs and their latest builds.

It sends that with the question to the company AI gateway. The gateway's key and
secret stay on the server, and the model never calls Jira or Jenkins itself.

**Set up (Docker), Gemini on Vertex AI through Apigee:**

1. `cp ai.env.example ai.env` and fill in:
   - `AI_BASE_URL`: the Apigee gateway address;
   - `AI_PROJECT_ID`, `AI_LOCATION`: the Google Cloud project id and region;
   - `AI_MODEL`: the model id, e.g. `gemini-2.5-flash`;
   - `AI_TOKEN_URL`, `AI_CLIENT_ID`, `AI_CLIENT_SECRET`: the OAuth login.

   The server exchanges the client id and secret for a token (client
   credentials), caches it until it expires and sends it as
   `Authorization: Bearer …` to
   `{AI_BASE_URL}/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent?alt=sse`.
   This is the same request the AI Relay IDE extension sends. If you use that
   extension, copy the values from `~/.airelay/config.properties`; the mapping
   is in `ai.env.example`.
   If `AI_BASE_URL` already ends with `:generateContent` (or `AI_PATH=/`),
   nothing is appended. On a 404 the check tries the usual paths under
   `AI_BASE_URL` and prints the `AI_PATH` that works.
   If your proxy uses another path, set `AI_PATH`. `ai.env` is never committed.
2. Run `docker compose up -d`.
3. Check the settings: `docker compose exec app node dist-server/server/ai/check.js`.
   It asks the model one tiny question and says what failed:
   - the login: client id, secret, `AI_TOKEN_AUTH`;
   - the path: project, location, model;
   - the certificate. In this case it prints the certificate's details and an
     `AI_CA_CERT=…` line. Check that it is your company's, add the line to
     `ai.env`, and run `docker compose up -d` again.

Other gateways: `AI_FORMAT=gemini` uses the Gemini API, and `AI_FORMAT=openai`
uses OpenAI-compatible chat completions. Both take a static key and secret
through `AI_HEADERS` (see `ai.env.example`).

For local development, put the same variables in `.env`.

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
