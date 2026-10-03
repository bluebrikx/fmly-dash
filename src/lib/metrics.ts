// Pure helpers for the /admin/metrics dashboard (PLAN.md Phase 11).
// Dependency-free so scripts/check-admin-metrics.mts can exercise them.

export type DayPoint = { day: string; value: number };

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The last `count` UTC days ending at `today`, oldest first ("YYYY-MM-DD").
export function lastDays(count: number, today: Date): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(utcDayKey(new Date(today.getTime() - i * 86_400_000)));
  }
  return out;
}

// One point per requested day; days with no row are 0. When several sources
// report the same day (live view vs the daily_metrics snapshot) the larger
// wins: the snapshot protects against history trimmed from the source tables,
// the live view is fresher for today.
export function fillDays(days: string[], ...sources: Array<Record<string, number>>): DayPoint[] {
  return days.map((day) => ({
    day,
    value: Math.max(0, ...sources.map((s) => s[day] ?? 0)),
  }));
}

export function toDayMap(rows: Array<{ day: string }>, field: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    const v = Number((row as Record<string, unknown>)[field]);
    if (Number.isFinite(v)) map[row.day] = v;
  }
  return map;
}

// Smallest "clean" axis maximum >= value (1, 2, 5, 10, 20, 50, ...).
export function niceMax(value: number): number {
  if (value <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 5, 10]) {
    if (step * pow >= value) return step * pow;
  }
  return 10 * pow;
}

export type ErrorRow = { route: string; method: string; status: number; hits: number };

// Collapses per-day rows into one row per route/method/status, busiest first.
export function aggregateErrors(rows: ErrorRow[]): ErrorRow[] {
  const map = new Map<string, ErrorRow>();
  for (const r of rows) {
    const key = `${r.method} ${r.route} ${r.status}`;
    const cur = map.get(key);
    if (cur) cur.hits += r.hits;
    else map.set(key, { ...r });
  }
  return [...map.values()].sort((a, b) => b.hits - a.hits || a.route.localeCompare(b.route));
}

export function average(points: DayPoint[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.value, 0) / points.length;
}
