import { getPool } from "./db.ts";
import { ERROR_ROW_LIMIT, type ErrorRow, type InviteDayRow } from "./metrics.ts";

// The subset of pg's Pool used by loadInviteMetrics, so tests can inject a
// fake pool/client without a real database (see scripts/check-metrics.mts).
export type QueryablePool = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

// Plain SELECTs on the ops views from fmly-chores migration 0052 -- the only
// objects the metrics_reader role can read. Counts are cast to int and days to
// text so pg doesn't hand back bigint strings / Date objects.

export type DayRow = { day: string } & Record<string, number | string>;

export type Lead = {
  household_id: string;
  tier: string | null;
  subscription_status: string | null;
  first_hit_at: string;
  last_hit_at: string;
  days_hit: number;
  total_hits: number;
  kinds: string[];
  members: number;
  active_devices: number;
  status: string;
  notes: string | null;
  invites: number;
};

export type InviteMetrics = { available: boolean; rows: InviteDayRow[] };

export type MetricsData = {
  active: DayRow[];
  walls: DayRow[];
  snapshots: DayRow[];
  leads: Lead[];
  errors: ErrorRow[];
  invites: InviteMetrics;
};

// Invite daily metrics (issue #179): daily_metrics.invites_sent /
// invite_joins, added by a chores migration. That migration has not landed
// on every database yet, so this is deliberately its own isolated query,
// never folded into the snapshot select above, and it never rejects:
//   1. Catalog pre-check -- only select the columns when they exist.
//   2. The whole thing (pre-check and query) is wrapped in one try/catch, so
//      ANY failure -- a missing column, a connection hiccup, anything else --
//      degrades to { available: false } rather than throwing. The error is
//      logged server-side only (message text, never the connection string)
//      so it never reaches the page or a rendered error message.
export async function loadInviteMetrics(
  since: string,
  pool: QueryablePool | null = getPool(),
): Promise<InviteMetrics> {
  if (!pool) return { available: false, rows: [] };
  try {
    const present = await pool.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
         where table_schema = 'public' and table_name = 'daily_metrics'
           and column_name = any($1)`,
      [["invites_sent", "invite_joins"]],
    );
    if ((present.rows[0]?.n ?? 0) < 2) return { available: false, rows: [] };
    const r = await pool.query<InviteDayRow>(
      `select day::text, invites_sent::int, invite_joins::int
         from daily_metrics where day >= $1 order by day`,
      [since],
    );
    return { available: true, rows: r.rows };
  } catch (err) {
    console.error("[invites] loadInviteMetrics failed:", err instanceof Error ? err.message : err);
    return { available: false, rows: [] };
  }
}

export async function loadMetrics(since: string, errorsSince: string): Promise<MetricsData> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set");
  // Kept outside the Promise.all below: loadInviteMetrics swallows every
  // failure into { available: false } (logging server-side), so it can
  // never reject and never affects whether the rest of the page loads.
  const invites = await loadInviteMetrics(since);
  const [active, walls, snapshots, leads, errors] = await Promise.all([
    pool.query(
      `select day::text, active_households::int, chore_completed_households::int
         from v_daily_active_households where day >= $1`,
      [since],
    ),
    pool.query(
      `select day::text, pro_required_households::int, device_limit_households::int
         from v_daily_wall_events where day >= $1`,
      [since],
    ),
    pool.query(
      `select day::text, active_households, chore_completed_households,
              pro_required_households, device_limit_households
         from daily_metrics where day >= $1`,
      [since],
    ),
    pool.query(
      `select household_id::text, tier, subscription_status,
              first_hit_at::text, last_hit_at::text,
              days_hit::int, total_hits::int, kinds::text[] as kinds,
              members::int, active_devices::int,
              status, notes, invites::int
         from v_upgrade_leads order by last_hit_at desc limit 50`,
    ),
    pool.query(
      `select day::text, route, method, status::int, hits::int
         from http_error_counts where day >= $1
        order by day desc, hits desc limit $2`,
      [errorsSince, ERROR_ROW_LIMIT],
    ),
  ]);
  return {
    active: active.rows,
    walls: walls.rows,
    snapshots: snapshots.rows,
    leads: leads.rows,
    errors: errors.rows as ErrorRow[],
    invites,
  };
}
