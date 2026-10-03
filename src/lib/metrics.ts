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

// One row per day/route/method/status, as stored in http_error_counts.
export type ErrorRow = { day: string; route: string; method: string; status: number; hits: number };

export type ErrorSort = "day" | "hits";
export type ErrorDir = "asc" | "desc";
export type ErrorQuery = {
  route: string; // case-insensitive substring; "" = any
  method: string; // exact (upper-case); "" = any
  status: string; // "401", "4xx", "5xx"; "" = any
  sort: ErrorSort;
  dir: ErrorDir;
};

export const DEFAULT_ERROR_QUERY: ErrorQuery = { route: "", method: "", status: "", sort: "day", dir: "desc" };

type Params = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// Turns untrusted URL params into a safe ErrorQuery: unknown values fall back to defaults.
export function parseErrorQuery(params: Params): ErrorQuery {
  const route = first(params.route).trim().slice(0, 100);
  const method = first(params.method).trim().toUpperCase();
  const status = first(params.status).trim().toLowerCase();
  const sort = first(params.sort);
  const dir = first(params.dir);
  return {
    route,
    method: /^[A-Z]{1,10}$/.test(method) ? method : "",
    status: /^([1-5]\d\d|[45]xx)$/.test(status) ? status : "",
    sort: sort === "hits" ? "hits" : "day",
    dir: dir === "asc" ? "asc" : "desc",
  };
}

// Choices for the filter dropdowns, from the rows actually present.
export function errorFilterOptions(rows: ErrorRow[]): { methods: string[]; statuses: number[] } {
  return {
    methods: [...new Set(rows.map((r) => r.method))].sort(),
    statuses: [...new Set(rows.map((r) => r.status))].sort((a, b) => a - b),
  };
}

function statusMatches(status: number, filter: string): boolean {
  if (!filter) return true;
  if (filter === "4xx") return status >= 400 && status < 500;
  if (filter === "5xx") return status >= 500 && status < 600;
  return String(status) === filter;
}

// Filters, then sorts. Ties always break the same way (hits desc, newest day,
// route, method, status) so the order is stable between reloads.
export function applyErrorQuery(rows: ErrorRow[], q: ErrorQuery): ErrorRow[] {
  const needle = q.route.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!needle || r.route.toLowerCase().includes(needle)) &&
      (!q.method || r.method === q.method) &&
      statusMatches(r.status, q.status),
  );
  const sign = q.dir === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    const primary = q.sort === "hits" ? a.hits - b.hits : a.day.localeCompare(b.day);
    if (primary !== 0) return primary * sign;
    return (
      b.hits - a.hits ||
      b.day.localeCompare(a.day) ||
      a.route.localeCompare(b.route) ||
      a.method.localeCompare(b.method) ||
      a.status - b.status
    );
  });
}

// Link target for a column header / form: keeps the current filters, changes
// only what is passed. Default values are omitted so the plain URL stays "/".
export function errorQueryHref(q: ErrorQuery, change: Partial<ErrorQuery> = {}): string {
  const next = { ...q, ...change };
  const p = new URLSearchParams();
  if (next.route) p.set("route", next.route);
  if (next.method) p.set("method", next.method);
  if (next.status) p.set("status", next.status);
  if (next.sort !== DEFAULT_ERROR_QUERY.sort || next.dir !== DEFAULT_ERROR_QUERY.dir) {
    p.set("sort", next.sort);
    p.set("dir", next.dir);
  }
  const qs = p.toString();
  return qs ? `/?${qs}#api-errors` : "/#api-errors";
}

// Header click: same column flips direction; a new column starts descending.
export function nextSort(q: ErrorQuery, column: ErrorSort): Pick<ErrorQuery, "sort" | "dir"> {
  if (q.sort === column) return { sort: column, dir: q.dir === "desc" ? "asc" : "desc" };
  return { sort: column, dir: "desc" };
}

export function average(points: DayPoint[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.value, 0) / points.length;
}
