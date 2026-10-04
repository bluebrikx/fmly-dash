import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { COOKIE_NAME, adminConfigured, isValidSession } from "@/lib/admin-auth";
import { loadMetrics, type Lead } from "@/lib/queries";
import {
  applyErrorQuery,
  average,
  errorFilterOptions,
  errorQueryHref,
  fillDays,
  lastDays,
  nextSort,
  paginate,
  parseErrorQuery,
  routeSeries,
  toDayMap,
  utcDayKey,
  ERROR_ROW_LIMIT,
  type ErrorSort,
} from "@/lib/metrics";
import { BarChart } from "./bar-chart";
import { LineChart } from "./line-chart";
import { LoginForm } from "./login-form";
import { adminLogout } from "./actions";

// Operator dashboard: active households, free-tier wall
// hits (402 pro_required / 420 device_limit), upgrade leads, API error counts.
// Reads the fmly-chores migration-0052 views over a read-only
// Postgres role (metrics_reader), behind the ADMIN_TOKEN sign-in. Days are UTC. Household ids only -- no emails.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Metrics",
  robots: { index: false, follow: false },
};

const DAYS = 30;

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-2xl border-2 border-ink/20 bg-porcelain p-4">
      <p className="font-sans text-xs text-ink/60">{label}</p>
      <p className="font-display text-4xl text-ink tabular-nums">{value}</p>
      {note && <p className="font-sans text-xs text-ink/60">{note}</p>}
    </div>
  );
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!adminConfigured()) notFound();

  const session = (await cookies()).get(COOKIE_NAME)?.value;
  if (!isValidSession(session)) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-5 py-16">
        <h1 className="font-display text-3xl text-ink">Metrics</h1>
        <LoginForm />
      </main>
    );
  }

  const today = new Date();
  const days = lastDays(DAYS, today);
  const since = days[0];
  const errorsSince = lastDays(7, today)[0];

  let data;
  try {
    data = await loadMetrics(since, errorsSince);
  } catch (err) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <h1 className="font-display text-3xl text-ink">Metrics</h1>
        <p className="mt-3 font-sans text-sm text-diner-red">
          Couldn&apos;t load metrics: {err instanceof Error ? err.message : "unknown error"}. Check
          DATABASE_URL and that fmly-chores migration 0052 has been applied.
        </p>
        <a href="/logout" className="mt-4 inline-block font-sans text-sm text-ink/60 underline">
          Sign out
        </a>
      </main>
    );
  }

  const activeRows = data.active;
  const wallRows = data.walls;
  const snapRows = data.snapshots;
  const activePoints = fillDays(days, toDayMap(activeRows, "active_households"), toDayMap(snapRows, "active_households"));
  const proPoints = fillDays(days, toDayMap(wallRows, "pro_required_households"), toDayMap(snapRows, "pro_required_households"));
  const devicePoints = fillDays(days, toDayMap(wallRows, "device_limit_households"), toDayMap(snapRows, "device_limit_households"));
  const errorQuery = parseErrorQuery(await searchParams);
  const errorOptions = errorFilterOptions(data.errors);
  const errorRows = applyErrorQuery(data.errors, errorQuery);
  const errorPage = paginate(errorRows, errorQuery.page);
  const chartSeries = routeSeries(errorRows, lastDays(7, today), 5);
  const errorsFiltered = Boolean(errorQuery.route || errorQuery.method || errorQuery.status);
  const leadRows = data.leads as Lead[];

  const todayKey = utcDayKey(today);
  const todayActive = activePoints[activePoints.length - 1].value;
  const yesterdayActive = activePoints[activePoints.length - 2]?.value ?? 0;
  const avg7 = average(activePoints.slice(-7));
  const total5xx = errorRows.filter((e) => e.status >= 500).reduce((s, e) => s + e.hits, 0);
  const total4xx = errorRows.filter((e) => e.status < 500).reduce((s, e) => s + e.hits, 0);
  const sortMark = (col: ErrorSort) => (errorQuery.sort === col ? (errorQuery.dir === "desc" ? " ↓" : " ↑") : "");

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-10">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Metrics</h1>
          <p className="font-sans text-xs text-ink/60">
            Days are UTC · today is {todayKey} · household ids only, no emails
          </p>
        </div>
        <form action={adminLogout}>
          <button type="submit" className="font-sans text-sm text-ink/60 underline">
            Sign out
          </button>
        </form>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Active households today" value={todayActive} note={`yesterday ${yesterdayActive}`} />
        <Tile label="7-day average" value={avg7.toFixed(1)} note="active households / day" />
        <Tile label="Pro required today" value={proPoints[proPoints.length - 1].value} note="households hit 402" />
        <Tile label="Device limit today" value={devicePoints[devicePoints.length - 1].value} note="households hit 420" />
      </section>

      <BarChart title="Active households per day" unit="households" points={activePoints} color="var(--ink-soft)" />
      <div className="grid gap-6 md:grid-cols-2">
        <BarChart title="Hit “Pro required” (402)" unit="households" points={proPoints} color="var(--diner-red)" compact />
        <BarChart title="Hit “Device limit” (420)" unit="households" points={devicePoints} color="var(--mustard)" compact />
      </div>

      <section className="rounded-2xl border-2 border-ink/20 bg-porcelain p-4">
        <h2 className="font-marker text-base text-ink">Upgrade leads</h2>
        <p className="mb-3 font-sans text-xs text-ink/60">
          Households that hit a free-tier wall, most recent first. Set Status and Notes in the Supabase table editor (table upgrade_leads); look the owner up there by id. Invites = times an adult copied the invite code or showed the QR.
        </p>
        {leadRows.length === 0 ? (
          <p className="font-sans text-sm text-ink-soft">No wall hits recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] font-sans text-xs text-ink-soft">
              <thead>
                <tr className="text-left text-ink/60">
                  <th className="py-1 pr-3 font-normal">Household</th>
                  <th className="py-1 pr-3 font-normal">Tier</th>
                  <th className="py-1 pr-3 font-normal">Wall</th>
                  <th className="py-1 pr-3 font-normal">Status</th>
                  <th className="py-1 text-right font-normal" title="Times an adult copied the invite code or showed the QR">Invites</th>
                  <th className="py-1 text-right font-normal">Days</th>
                  <th className="py-1 text-right font-normal">Hits</th>
                  <th className="py-1 text-right font-normal">Members</th>
                  <th className="py-1 text-right font-normal">Devices</th>
                  <th className="py-1 text-right font-normal">Last hit</th>
                </tr>
              </thead>
              <tbody>
                {leadRows.map((l) => (
                  <tr key={l.household_id} className="border-t border-ink/10">
                    <td className="py-1 pr-3 font-mono" title={l.household_id}>
                      {l.household_id}
                    </td>
                    <td className="py-1 pr-3">{l.tier === "pro" ? `pro (${l.subscription_status ?? "—"})` : "free"}</td>
                    <td className="py-1 pr-3">{l.kinds.join(", ")}</td>
                    <td className="py-1 pr-3" title={l.notes ?? undefined}>
                      {l.status}
                      {l.notes ? " ✎" : ""}
                    </td>
                    <td className="py-1 text-right tabular-nums">{l.invites}</td>
                    <td className="py-1 text-right tabular-nums">{l.days_hit}</td>
                    <td className="py-1 text-right tabular-nums">{l.total_hits}</td>
                    <td className="py-1 text-right tabular-nums">{l.members}</td>
                    <td className="py-1 text-right tabular-nums">{l.active_devices}</td>
                    <td className="py-1 text-right" title={l.last_hit_at}>
                      {ago(l.last_hit_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="api-errors" className="rounded-2xl border-2 border-ink/20 bg-porcelain p-4">
        <h2 className="font-marker text-base text-ink">API errors, last 7 days</h2>
        <p className="mb-3 font-sans text-xs text-ink/60">
          {total5xx} server errors (alerted in Slack) · {total4xx} client errors (counted only)
          {errorsFiltered ? " · filtered" : ""} · {errorRows.length} of {data.errors.length} rows
          {data.errors.length >= ERROR_ROW_LIMIT ? ` (most recent ${ERROR_ROW_LIMIT} loaded)` : ""}
        </p>

        <form action="/" method="get" className="mb-3 flex flex-wrap items-end gap-3 font-sans text-xs text-ink-soft">
          <label className="flex flex-col gap-1">
            Route contains
            <input
              name="route"
              type="text"
              defaultValue={errorQuery.route}
              placeholder="/api/sync"
              maxLength={100}
              className="w-44 rounded-lg border-2 border-ink px-2 py-1 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            Method
            <select name="method" defaultValue={errorQuery.method} className="rounded-lg border-2 border-ink px-2 py-1 text-ink">
              <option value="">All</option>
              {errorOptions.methods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Status
            <select name="status" defaultValue={errorQuery.status} className="rounded-lg border-2 border-ink px-2 py-1 text-ink">
              <option value="">All</option>
              <option value="4xx">All 4xx</option>
              <option value="5xx">All 5xx</option>
              {errorOptions.statuses.map((st) => (
                <option key={st} value={String(st)}>
                  {st}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="sort" value={errorQuery.sort} />
          <input type="hidden" name="dir" value={errorQuery.dir} />
          <button
            type="submit"
            className="rounded-lg border-2 border-ink bg-mustard px-3 py-1 font-marker text-sm text-ink transition active:translate-y-0.5"
          >
            Apply
          </button>
          {errorsFiltered && (
            <a href={errorQueryHref(errorQuery, { route: "", method: "", status: "" })} className="py-1 underline">
              Clear filters
            </a>
          )}
        </form>

        {chartSeries.length > 0 && (
          <LineChart
            title="Errors per day, by route"
            note="Busiest 5 routes, the rest grouped as Other. Follows the filters above."
            series={chartSeries}
          />
        )}

        {errorRows.length === 0 ? (
          <p className="font-sans text-sm text-ink-soft">
            {errorsFiltered ? "No errors match these filters." : "No errors recorded."}
          </p>
        ) : (
          <table className="w-full font-sans text-xs text-ink-soft">
            <thead>
              <tr className="text-left text-ink/60">
                <th
                  className="py-1 pr-3 font-normal"
                  aria-sort={errorQuery.sort === "day" ? (errorQuery.dir === "desc" ? "descending" : "ascending") : "none"}
                >
                  <a href={errorQueryHref(errorQuery, nextSort(errorQuery, "day"))} className="underline">
                    Date (UTC){sortMark("day")}
                  </a>
                </th>
                <th className="py-1 pr-3 font-normal">Route</th>
                <th className="py-1 pr-3 font-normal">Method</th>
                <th className="py-1 pr-3 text-right font-normal">Status</th>
                <th
                  className="py-1 text-right font-normal"
                  aria-sort={errorQuery.sort === "hits" ? (errorQuery.dir === "desc" ? "descending" : "ascending") : "none"}
                >
                  <a href={errorQueryHref(errorQuery, nextSort(errorQuery, "hits"))} className="underline">
                    Errors{sortMark("hits")}
                  </a>
                </th>
              </tr>
            </thead>
            <tbody>
              {errorPage.rows.map((e) => (
                <tr key={`${e.day} ${e.method} ${e.route} ${e.status}`} className="border-t border-ink/10">
                  <td className="py-1 pr-3 tabular-nums">{e.day}</td>
                  <td className="py-1 pr-3 font-mono">{e.route}</td>
                  <td className="py-1 pr-3">{e.method}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{e.status}</td>
                  <td className="py-1 text-right tabular-nums">{e.hits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {errorRows.length > 0 && (
          <nav aria-label="Error table pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 font-sans text-xs text-ink-soft">
            <span>
              Showing {errorPage.from}–{errorPage.to} of {errorPage.total}
            </span>
            <span className="flex items-center gap-3">
              {errorPage.page > 1 ? (
                <a href={errorQueryHref(errorQuery, { page: errorPage.page - 1 })} rel="prev" className="underline">
                  ← Previous
                </a>
              ) : (
                <span className="text-ink/40" aria-disabled="true">
                  ← Previous
                </span>
              )}
              <span aria-current="page">
                Page {errorPage.page} of {errorPage.pages}
              </span>
              {errorPage.page < errorPage.pages ? (
                <a href={errorQueryHref(errorQuery, { page: errorPage.page + 1 })} rel="next" className="underline">
                  Next →
                </a>
              ) : (
                <span className="text-ink/40" aria-disabled="true">
                  Next →
                </span>
              )}
            </span>
          </nav>
        )}
      </section>
    </main>
  );
}
