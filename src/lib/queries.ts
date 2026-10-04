import { getPool } from "@/lib/db";
import { ERROR_ROW_LIMIT, type ErrorRow } from "@/lib/metrics";

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

export type MetricsData = {
  active: DayRow[];
  walls: DayRow[];
  snapshots: DayRow[];
  leads: Lead[];
  errors: ErrorRow[];
};

export async function loadMetrics(since: string, errorsSince: string): Promise<MetricsData> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set");
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
  };
}
