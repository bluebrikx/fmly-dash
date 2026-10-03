# fmly-dash

Isolated operator dashboard for [Fmly.Club](https://github.com/bluebrikx/chores). It is a separate app on purpose: no code, deploy or login is shared with the customer-facing app.

It shows active households per day, how many households hit the free-tier walls (402 `pro_required`, 420 `device_limit` = upgrade leads), a leads table, and API error counts. Days are UTC. Household ids only — no emails.

## How it reads data

Over **Postgres, as a read-only login** — not the Supabase service key. The `metrics_reader` role (created by fmly-chores migration `0052_ops_metrics.sql`) can `select` only these relations: `v_daily_active_households`, `v_daily_wall_events`, `v_upgrade_leads`, `daily_metrics`, `http_error_counts`. It cannot read `households`, `members`, emails, PIN hashes or chore content, and cannot write anything.

## Setup

1. Apply migration `0052` to the Supabase project (in the `chores` repo).
2. In the Supabase SQL editor, create the login (once; the password never goes in git):
   ```sql
   create role metrics_app login password '<long random>';
   grant metrics_reader to metrics_app;
   ```
3. Copy `.env.example` to `.env.local` and fill it in:
   - `DATABASE_URL` — Supabase pooler connection string, user `metrics_app`.
   - `DATABASE_CA` — recommended: the project's CA certificate (Database → SSL), so the connection is verified.
   - `ADMIN_TOKEN` — `openssl rand -base64 32` (≥ 32 chars; shorter or unset = every page 404s).
4. `npm install && npm run dev` → http://localhost:3100

### Where does `ADMIN_TOKEN` live?

- **Running locally only** (simplest, nothing exposed to the internet): in `.env.local` on your machine. Nothing else is needed.
- **Deployed** (e.g. Vercel): set `ADMIN_TOKEN`, `DATABASE_URL`, `DATABASE_CA` in the host's environment variables — a deployed app can't read your laptop's `.env.local`. `.env*` is git-ignored.

## Security notes

- Sign out / reset the session: open `/logout` (works from any screen, including error pages). Sessions also expire after 12 h; changing `ADMIN_TOKEN` signs everyone out.
- Sign-in: constant-time token check → httpOnly, `SameSite=Strict` cookie holding `<expiry>.<HMAC>`; sessions last 12 h, expire server-side, and **changing `ADMIN_TOKEN` revokes all of them**. All responses are `no-store`, `noindex`, un-frameable.
- The sign-in throttle (5 failures / 15 min / address) is **per server instance**. On serverless it is only a speed bump. If you deploy this, also turn on the host's protection (e.g. Vercel Deployment Protection / Firewall rate limiting) — or keep it local.
- Without `DATABASE_CA` the connection is encrypted but the server isn't authenticated.

## Checks

`npm run check` (pure logic + auth gate), `npm run lint`, `npx tsc --noEmit`, `npm run build`.
