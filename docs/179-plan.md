# Plan - Issue #179 Phase 11: Upgrade leads dashboard & external metrics service

Repo: `bluebrikx/fmly-dash` (isolated read-only operator dashboard, Next.js 16.2.12, App Router).
Reads chores Postgres as the read-only `metrics_reader` role.

## TL;DR

The dashboard is almost entirely built on `origin/main` == `origin/dev` (identical trees). Every
checklist item is either already shipped, or must be dropped because it conflicts with the read-only,
household-ids-only, no-emails design. The one genuine, in-scope, buildable gap is the **"Invites sent
(viral signal)"** daily trend plus an invites -> joins conversion ratio, sourced from
`daily_metrics.invites_sent` / `invite_joins`, which a chores migration adds (not yet applied to any
database). It must degrade gracefully until that migration lands.

Recommendation: **build the gap** (one small panel). It is low risk and reuses existing components.

## Branch / repo state

- `origin/dev` and `origin/main` have **identical file trees** (`git diff origin/dev origin/main` is
  empty). `main` is 6 merge commits ahead of `dev` but with no content difference. Branch the new work
  off `origin/dev` per the workflow rule; a `dev`<-`main` fast-forward is a separate housekeeping step,
  not needed for this work.
- `origin/claude/leads-status-invites` is **fully merged into dev** (`bdad322`, PR #7): no commits and
  no diff ahead of dev. Nothing to supersede or salvage; it already shipped the lead status / notes /
  invites column. Treat it as done, do not build on it as if unfinished.
- Other `claude/*` remote branches (`error-table-controls`, `errors-line-chart`, `errors-pagination`,
  `initial-dashboard`, `logout-route`) are all merged into dev as well (their merge commits are in the
  dev log). No live unmerged work exists.

## Audit table

Evidence paths are in `fmly-dash` unless prefixed `chores:`.

| Checklist item | Status | Evidence |
|---|---|---|
| Scaffold `fmly-dash` repo | built | `package.json`, `src/app/page.tsx`, `src/app/layout.tsx` |
| Connect via `metrics_reader` connection string | built | `src/lib/db.ts:7-27` (pool, SSL, statement_timeout), `README.md:7-23` |
| Query: Daily Active Households (DAU) | built | `src/lib/queries.ts:38-42` (`v_daily_active_households`) |
| Query: 402/420 wall events | built | `src/lib/queries.ts:43-47` (`v_daily_wall_events`) |
| Query: Upgrade leads | built | `src/lib/queries.ts:54-61` (`v_upgrade_leads`, limit 50) |
| Query: Invites sent (viral signal) | **partly -> GAP** | per-household `invites` shown (`queries.ts:59`, from `v_upgrade_leads`), but **no daily `invites_sent` trend / conversion**; `daily_metrics` select omits the columns (`queries.ts:48-53`). Columns land with a chores migration |
| Chart: 402 over time | built | `src/app/page.tsx:143` (`BarChart` proPoints) |
| Chart: 420 over time | built | `src/app/page.tsx:144` (`BarChart` devicePoints) |
| List: households hitting wall most | built | `src/app/page.tsx:147-197` (leads table, `last_hit_at desc`) |
| Leads table: household/members/devices/days/tier | built | `src/app/page.tsx:156-191` |
| Leads table: owner email (lookup) | **drop** | conflicts with design; `metrics_reader` cannot read `households`/emails (chores:`0052_ops_metrics.sql:252-254` grants). Header says "household ids only, no emails" (`page.tsx:30,124`) |
| Leads table: sortable + filter by tier/days/members | missing (minor) | static order only; no leads filters (errors table has them). Not required to close #179 |
| Action: Mark contacted / Convert (CRM writes) | **drop** | read-only role, no POST. Surfaced read-only via Supabase table editor: `status`/`notes` columns shown (`page.tsx:179-182,149-150`), chores:`0053_invite_events_leads.sql:38-71` |
| Chart: DAU trend 7/14/30d | built (30d; selector minor) | `page.tsx:37,74` 30d, 7-day avg tile `page.tsx:136`. No 7/14/30 toggle (minor) |
| Breakdown: Free vs Pro households (daily) | **drop (not feasible)** | allowed relations have no per-day tier split; `metrics_reader` cannot read `households` by tier per day. Would need a new chores view + grant (separate issue) |
| Funnel (optional) | **drop (out of scope)** | signups/household-create not among the 5 allowed relations; marked optional in the issue |
| Private dashboard (not customer-facing) | built | `src/lib/admin-auth.ts`, `page.tsx:61-71` (`notFound` when unconfigured) |
| Auth via GitHub/Vercel | built (alt) | shared `ADMIN_TOKEN` HMAC-cookie gate instead of OAuth (`admin-auth.ts:30-52`), host protection noted `README.md:34`. Acceptable for single operator |
| Role-based ops/marketing/founder | drop (over-spec) | single shared token; no multi-role need for one operator |
| Read-only (no mutations) | built | `metrics_reader` select-only; no write path anywhere (`db.ts`, `queries.ts`) |
| Metrics updated daily by cron | built (chores side) | chores `household-cleanup` writes `daily_metrics`; dashboard merges snapshot vs live (`src/lib/metrics.ts:23-28` `fillDays`) |
| Dashboard refreshes daily/on-demand | built | `export const dynamic = "force-dynamic"` (`page.tsx:31`) - live every request |
| Data retention >= 90 days | built (chores side) | `daily_metrics` snapshots persist history; dashboard reads them (`queries.ts:48-53`). Retention is a chores concern |

Net: **1 genuine buildable gap** (invite daily metrics), everything else built or correctly dropped.

## The gap: invite daily metrics

### What the migration provides (verified against the chores branch that adds it)

`daily_metrics` gains two `integer not null default 0` columns, appended (never reordered):
- `invites_sent` = `sum(invite_events.hits)` per UTC day where `kind <> 'code_regenerated'`.
- `invite_joins` = approved joins that day (non-first active devices by `created_at` date).

Grants are unchanged: `metrics_reader` keeps its `0052` select grant + RLS policy on `daily_metrics`;
the two new columns are covered automatically. No new grant, no new relation. Conversion is **not**
stored - the dashboard computes `invite_joins / invites_sent` over a window (zero-denominator handled
by the reader). The migration is **not applied to any database yet**, so graceful degradation is the
primary behaviour to ship and the main thing to verify.

### Query design (`src/lib/queries.ts`)

Keep the existing `daily_metrics` snapshot select at `queries.ts:48-53` **unchanged** - it must never
select the new columns, so the main page keeps working before that migration is applied.

Add an isolated loader that selects the new columns only when they exist, so there is no path where a
missing column 500s the page, and that never rejects for *any* loading error (not only a missing
column) - any failure here must degrade to "not available", with the detail logged server-side only,
never thrown into the page or into a rendered error message:

```ts
export type InviteDayRow = { day: string; invites_sent: number; invite_joins: number };
export type InviteMetrics = { available: boolean; rows: InviteDayRow[] };

export async function loadInviteMetrics(since: string): Promise<InviteMetrics> {
  const pool = getPool();
  if (!pool) return { available: false, rows: [] };
  try {
    // Conditional: only query the columns when the catalog shows both exist
    // (absent before the migration is applied).
    const present = await pool.query(
      `select count(*)::int as n from information_schema.columns
         where table_schema = 'public' and table_name = 'daily_metrics'
           and column_name = any($1)`,
      [["invites_sent", "invite_joins"]],
    );
    if (present.rows[0].n < 2) return { available: false, rows: [] };
    const r = await pool.query(
      `select day::text, invites_sent::int, invite_joins::int
         from daily_metrics where day >= $1 order by day`,
      [since],
    );
    return { available: true, rows: r.rows as InviteDayRow[] };
  } catch (err) {
    // Any failure (missing column, connection hiccup, etc.) degrades to
    // "not available" rather than rejecting; log server-side only, never
    // render the detail.
    console.error("[invites] loadInviteMetrics failed:", err);
    return { available: false, rows: [] };
  }
}
```

Wire it into `loadMetrics` so one invite failure can never reject the whole bundle: run it as its own
awaited call (not inside the existing `Promise.all`), or add it to the array already resolved to its
fallback. Extend `MetricsData` with `invites: InviteMetrics`. All SQL stays parameterised ($1); the
column list is a bound array literal, never interpolated; no user input reaches this query.

### Pure helpers (`src/lib/metrics.ts`) - written test-first

```ts
// Conversion as a 1dp percentage; null when there were no invites (no denominator).
export function conversionPct(sent: number, joins: number): number | null {
  if (!Number.isFinite(sent) || sent <= 0) return null;
  return Math.round((joins / sent) * 1000) / 10;
}
export function formatPct(n: number | null): string { return n === null ? "n/a" : `${n}%`; }

// Pure summary for the panel: points + trailing-7d totals + conversion. No DB, fully testable.
export function summariseInvites(rows: InviteDayRow[], days: string[]): {
  sent: DayPoint[]; joins: DayPoint[]; sent7: number; joins7: number; pct7: number | null;
} { /* fillDays(days, toDayMap(rows,"invites_sent")) etc; sum last 7; conversionPct(sent7,joins7) */ }
```

Reuse existing `fillDays`, `toDayMap`, `niceMax`, `average` - do not duplicate.

### UI (`src/app/page.tsx`)

Add one `<section>` ("Invites"), always mounted (aria-stable, no empty-wrapper gaps per REVIEW.md):
- `data.invites.available === false` -> muted panel: "Invite metrics are not available yet. Apply
  the chores migration that adds `daily_metrics.invites_sent` and `invite_joins`." No chart, no 500.
- available -> a tile row ("Invites sent (7d)", "Approved joins (7d)", "Conversion (7d)" via
  `formatPct`) plus a reused `BarChart` for invites-sent per day (and optionally approved-joins per
  day). Pick a chart colour from an existing `globals.css` token distinct from mustard/diner-red; if a
  new hue is genuinely needed, add one `--token` following the dataviz palette - no hard-coded hex.
- Copy: NZ English, regular hyphens only (no em/en dashes).

Any database error that reaches the page (not just the invites loader) must render a generic message
("Could not load metrics. Check the server log.") and never the raw driver error, since that can
include a host, role or other connection detail. Log the real error server-side only.

No new env vars, no client-side DB exposure (server component only), auth gate / no-store / noindex /
rate-limit all inherited unchanged.

### Tests to add (`scripts/check-metrics.mts`, TDD - add these red first)

- `conversionPct(0, 0)` -> `null`; `conversionPct(0, 5)` -> `null` (zero denominator).
- `conversionPct(12, 3)` -> `25`; `conversionPct(3, 1)` -> `33.3` (1dp rounding).
- `formatPct(null)` -> `"n/a"`; `formatPct(25)` -> `"25%"`.
- `summariseInvites` over a 3-day window: zero-fills missing days, sums the trailing 7, and returns
  `pct7` consistent with `conversionPct`; empty rows -> all-zero points and `pct7 === null`.
- `loadInviteMetrics` degrades to `{ available: false, rows: [] }` on any thrown error, not only a
  missing-column error; exercise with a fake pool/client that throws something else to be sure the
  catch is not accidentally narrowed to one error code.

The DB degradation path for a genuinely missing column is not unit-testable without a database; it is
covered by manual verification against a database without that migration applied.

### README updates (`README.md`)

- Features line (~L5): add invites sent per day and the invites -> joins conversion.
- Relations note (~L9): `daily_metrics` also carries `invites_sent` / `invite_joins` after a chores
  migration is applied; the dashboard degrades gracefully (shows "not available yet") until then.
- Setup: note that invite metrics stay hidden until that chores migration is applied.
- Note that database error detail is always logged server-side and never rendered to the page.

## Manual verification list

1. **Before that migration is applied**: deploy the branch and sign in. Invites section shows the
   "not available yet" panel; the page returns 200 and every other panel (DAU, walls, leads, errors)
   renders. No 500, no console error. Check an existing household path too.
2. **After that migration is applied**: invites-sent bars populate; tiles show the trailing-7d
   sums; "Conversion (7d)" equals `round(joins/sent*100, 1)`; a window with zero invites shows "n/a".
3. `npm run check` (new conversion/summarise cks pass), `npm run lint`, `npx tsc --noEmit`,
   `npm run build` all pass.
4. Confirm: no new env var, connection still `metrics_reader`, no write/mutation added, invite data is
   aggregate counts only (no household ids, no emails); any database error shows only a generic
   message on the page, with the detail in the server log.

## Task breakdown for a Sonnet implementer (new branch off `origin/dev`)

Branch `feat/179-invite-metrics` off `origin/dev`, own git worktree.

1. `npm ci`; read the relevant guide under `node_modules/next/dist/docs/` (data fetching / server
   components) before writing code - this Next.js has breaking changes. The new work reuses the
   existing async-server-component + `force-dynamic` pattern; introduce no new Next API surface.
2. **Tests first (red)**: add `conversionPct` / `formatPct` / `summariseInvites` cks to
   `scripts/check-metrics.mts`; `npm run check` fails.
3. Implement the three pure helpers + `InviteDayRow` type in `src/lib/metrics.ts`; `npm run check`
   green.
4. Add `loadInviteMetrics` + `InviteMetrics` to `src/lib/queries.ts` (catalog pre-check, catching any
   error and logging it server-side rather than narrowing to one error code), extend `MetricsData`,
   wire into `loadMetrics` without touching the existing snapshot select and without letting its
   failure reject the bundle.
5. Add the Invites `<section>` to `src/app/page.tsx` (tiles + reused `BarChart`, graceful
   unavailable state, aria-stable, NZ English, no em/en dashes); make sure the page-level database
   error message stays generic and the detail only goes to the server log.
6. Update `README.md` (features, relations note, setup caveat, error-logging note).
7. Run `npm run check`, `npm run lint`, `npx tsc --noEmit`, `npm run build` - all green.
8. Manual verification per the list above (degradation path first, against a database without that
   migration applied). Open a PR targeting `dev`; have a fresh-context agent review the full branch
   diff per `.github/REVIEW.md` before marking done.

## Owner decisions taken as defaults (flag if any is wrong)

1. Drop "Mark contacted / Convert" CRM write actions - read-only role; already surfaced read-only via
   the Supabase table editor (`status`/`notes`).
2. Drop "owner email (lookup)" - violates the household-ids-only / no-emails design; `metrics_reader`
   has no access to emails.
3. Drop "Free vs Pro daily breakdown" and "Funnel" - not derivable from the 5 allowed relations; would
   need new chores views + grants (raise a separate issue if wanted).
4. Keep the single shared `ADMIN_TOKEN` gate (not GitHub OAuth + RBAC) - fine for a single operator.
5. Leads-table filters/sort and a DAU 7/14/30 selector are deferred polish, not required to close #179.
6. Build the invite panel now with graceful degradation; it ships before that chores migration (showing
   "not available yet") and lights up automatically once it is applied. No dependency ordering needed.
