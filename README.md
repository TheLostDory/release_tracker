# Release Tracker

Internal tool for tracking release candidates from identification through deployment.

React + TypeScript + Vite SPA, Tailwind CSS + shadcn/ui, TanStack Query, React Router, Supabase (Postgres, Auth).

## Getting started

Prerequisites: Node 20+, Docker (for the local Supabase stack).

```bash
npm install
npm run db:start          # starts local Supabase, applies migrations + seed
cp .env.example .env.local
# paste the "Publishable" key printed by db:start into VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev               # http://localhost:5173
```

Sign in with a seed user: `charbel@example.com` / `password123`
(also `john@`, `maya@`, `omar@example.com`, same password).

## Scripts

| Script              | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Vite dev server                                                |
| `npm run build`     | Type-check and production build                                |
| `npm run typecheck` | `tsc -b` (strict)                                              |
| `npm run lint`      | oxlint                                                         |
| `npm test`          | Vitest unit tests                                              |
| `npm run db:start`  | Start local Supabase                                           |
| `npm run db:reset`  | Recreate the local DB from migrations + `supabase/seed.sql`    |
| `npm run db:push`   | Apply new migrations to the linked hosted project              |
| `npm run db:types`  | Regenerate `src/types/database.ts` from the linked project (`db:types:docker` for the Docker stack) |
| `npm run smoke`     | End-to-end check of a running backend (needs `SMOKE_URL`, `SMOKE_KEY`; see `scripts/smoke-test.mjs`) |

Run `npm run db:types` after every migration change.

## Layout

```
supabase/
  migrations/      schema, triggers, RLS
  seed.sql         dev data (dates relative to current_date)
src/
  components/      shared UI (ui/ = shadcn primitives, layout/ = app shell)
  features/        domain modules: api.ts (Supabase queries), queries.ts (TanStack hooks), components
  layouts/         route layouts
  lib/             framework-agnostic helpers (dates, workflow definition, clients)
  pages/           route entry points (lazy-loaded)
  services/        cross-cutting services (auth)
  types/           generated DB types + domain types
```

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
- **By email**: existing users are added immediately; others join automatically when they sign up (or their account is created by an admin).
- **By link**: a role and an expiry (1–30 days). Anyone who opens it joins after signing in, or after creating an account (they're brought back to the invite). Only a SHA-256 hash is stored; revoke anytime.

Roles are enforced in Postgres (RLS + the membership functions in `supabase/migrations/20261013000000_projects.sql`); the UI only hides what you can't do.

## Run everything locally with Docker

One command, no Supabase account, no Node on the host. Only Docker:

```bash
docker compose up -d --build
```

Then open **http://localhost:8800** and sign in with a demo user: `charbel@example.com` / `password123` (all demo users share it). The demo has two projects: *Release Tracker* (sprints, full workflow) and *Mobile App* (no sprints, HIT only, no approval; `omar@example.com` is a viewer there).

The first run builds the app and initialises the database (a few minutes, mostly downloads). Later runs start in seconds. Data persists in the `db-data` volume.

| Container | What it is |
| --- | --- |
| `db` | Postgres (Supabase image), the same schema as hosted |
| `auth` | Supabase Auth (GoTrue): email/password, sign-up disabled |
| `rest` | PostgREST, the data API |
| `realtime` | Supabase Realtime, live updates on the release page |
| `migrate` | one-shot: applies `supabase/migrations`, loads `seed.sql` once, exits |
| `web` | nginx: serves the app and routes `/auth/v1`, `/rest/v1`, `/realtime/v1` on the same port |

### Install on another computer

1. Install a Docker runtime: Docker Desktop (needs a paid licence at larger companies), or free alternatives such as **Rancher Desktop** (choose the *dockerd/moby* engine) or **Podman Desktop** (with Docker compatibility).
2. Copy this folder (a zip of the repo is enough; no `node_modules` needed) and open a terminal in it.
3. Run `docker compose up -d --build` and open http://localhost:8800. The first run downloads ~2.5 GB of images plus npm packages; later starts are offline-capable.

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

Use `--build` again only when you have internet (it rebuilds the app from source).

Windows: run the command in PowerShell or Windows Terminal from the unzipped folder. If port 8800 or 54329 is taken, set `APP_PORT` / `DB_PORT`, e.g. `$env:APP_PORT=8900; docker compose up -d --build`.

Common tasks:

```bash
docker compose run --rm migrate create-user you@company.com 'a-long-password1' "Your Name"
docker compose logs -f                 # follow logs
docker compose down                    # stop (keeps data)
docker compose down -v                 # stop and DELETE all data
docker compose up -d --build           # after pulling code changes (applies new migrations)
SEED=false docker compose up -d --build   # first start without demo data
```

Ports are bound to `127.0.0.1` only: app on `8800` (`APP_PORT`), Postgres on `54329` (`DB_PORT`, user `postgres`).

**Secrets.** The defaults in `docker-compose.yml` are for local use only. To use your own, run `node docker/generate-keys.mjs`, then put `JWT_SECRET`, `ANON_KEY` and a `POSTGRES_PASSWORD` in a `.env` file next to `docker-compose.yml` (it is git-ignored) **before the first start**. Changing `POSTGRES_PASSWORD` later requires `docker compose down -v`.

Not included locally: the Supabase Studio dashboard and email sending. People create accounts on the **Create an account** page (confirmed immediately, since there is no email), or you add them with `create-user` above.

## Deploying (Cloudflare Pages, free)

The app is a static PWA (`npm run build` → `dist/`) talking to a hosted Supabase project. Hosting rules and security headers are in `public/_headers`. Cloudflare Pages serves `index.html` for unknown paths automatically, so deep links work.

### 1. Supabase (once)

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push            # schema only. Never load seed.sql in production
npx supabase config diff        # review before `config push`; never push blindly
```

In the Supabase dashboard:
- **Authentication → Sign In / Providers:** "Allow new users to sign up" **off** (email provider stays **on**).
- **Authentication → URL Configuration:** Site URL = your Pages URL, e.g. `https://release-tracker.pages.dev`.
- **Authentication → Users:** invite your team. Delete any `@example.com` demo users.

### 2. Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings:
   - Framework preset: **None** (or Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Environment variables** (Production *and* Preview):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_…` (public by design; **never** the secret/service_role key)
5. Deploy. The Node version comes from `.node-version`.

Every push to the main branch redeploys. Other branches get preview URLs; add those preview domains to Supabase's redirect URLs if you sign in on them.

### 3. Recommended: Cloudflare Access (free up to 50 users)

Adds a login wall in front of the whole site, so the app is invisible to anyone outside your company:
**Zero Trust → Access → Applications → Add → Self-hosted**, domain = your Pages URL, policy = *Allow* emails ending in `@yourcompany.com` (one-time PIN or Google/Microsoft login). Protect the preview URLs (`*.release-tracker.pages.dev`) too.

### 4. Backups

The Supabase free plan has **no automatic backups** and pauses after ~7 days of inactivity. For real data either upgrade (daily backups) or export regularly:

```bash
npx supabase db dump --data-only -f backup-$(date +%F).sql
```

### Other hosts

Any static host works if it can: serve `index.html` for unknown paths, apply the headers in `public/_headers`, and serve HTTPS. Netlify reads `_headers` too (add `/* /index.html 200` to `public/_redirects`). For nginx, see the example below.

| Path | Rule |
| --- | --- |
| any unknown path | serve `/index.html` (SPA fallback) |
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` |
| `/index.html`, `/sw.js`, `/manifest.webmanifest`, `/theme-init.js` | `Cache-Control: no-cache` |

```nginx
location / {
  try_files $uri /index.html;
  add_header Cache-Control "no-cache";
}
location /assets/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}
# plus the security headers from public/_headers, with `add_header ... always;`
```

### PWA behaviour

- Installable (manifest + icons). The service worker precaches the app shell, so it opens instantly after the first visit.
- Supabase requests are never cached by the service worker: release data and auth tokens stay out of the cache.
- New deploys show a "new version available, reload" toast instead of swapping code mid-session. Open tabs check for updates hourly.
- Regenerate icons after changing `public/icon.svg`: `npx pwa-assets-generator`.

## Security checklist

- **Open sign-up** (`/signup`). Safe because access is per project: a new account only sees projects it creates or is invited to. Passwords need 10+ characters with letters and digits. On hosted Supabase, sign-up must also be enabled in Authentication → Sign In / Providers (keep email confirmation on there).
- **Passwords:** minimum 10 characters, letters + digits, leaked-password protection on, "secure password change" on.
- **Never ship the service-role key** to the browser. Only the publishable key goes in `VITE_*` variables; row-level security protects the data.
- **RLS is enabled on every table.** There are no DELETE policies and the activity log is append-only.
- **User-entered links** (task links, report URLs) must be `http(s)`, enforced by `public.is_http_url()` in the database and `safeHttpUrl()` in the UI.
- **CSP:** scripts only from the app's own origin; network only to the app and Supabase.
- Project roles live in `project_members`; extend the checks in `20261013000000_projects.sql` for finer permissions.

## Conventions

- **Dates.** Calendar days (planned dates, sprint bounds, target deployment) are Postgres `date`, handled as `"YYYY-MM-DD"` strings via `src/lib/dates.ts`. Points in time (`completed_at`, `reviewed_at`, audit columns) are `timestamptz`, shown in the viewer's timezone.
- **Workflow creation.** Inserting a release runs a DB trigger that creates the 12 workflow tasks, 3 report rows and the approval row. The step list is mirrored in `src/lib/workflow.ts`.
- **Overall status** is computed client-side from tasks, reports and today's date. Only an optional manual `status_override` is stored.
- **Activity log** is written by DB triggers on releases, tasks, reports and approvals.
- **Authorization** is per project: `project_members.role` checked by RLS (`my_project_ids()` / `my_release_ids()`), and membership changes only through security-definer functions.
- **Status, next action, action items, calendar events** are pure functions in `src/lib/` (`release-status.ts`, `action-items.ts`, `calendar-events.ts`) with unit tests. Change the rules there.
- **Search** (`⌘K`) uses the `search_releases` SQL function (name, version, sprint, owner; RLS applies; signed-in users only).
- **Notifications** are derived action items (`src/lib/action-items.ts`) with stable ids, ready for a future email/Slack/Teams job.
- **Keyboard:** `⌘K` search & commands, `c` new release, `?` shortcuts, `g d / g s / g r / g c / g ,` navigation, `⌘B` toggle sidebar.
