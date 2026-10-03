import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { COOKIE_NAME, adminConfigured, isValidSession } from "@/lib/admin-auth";
import { loadMetrics, type Lead } from "@/lib/queries";
import {
  aggregateErrors,
  average,
  fillDays,
  lastDays,
  toDayMap,
  utcDayKey,
} from "@/lib/metrics";
import { BarChart } from "./bar-chart";
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

export default async function MetricsPage() {
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
      </main>
    );
  }

  const activeRows = data.active;
  const wallRows = data.walls;
  const snapRows = data.snapshots;
  const activePoints = fillDays(days, toDayMap(activeRows, "active_households"), toDayMap(snapRows, "active_households"));
  const proPoints = fillDays(days, toDayMap(wallRows, "pro_required_households"), toDayMap(snapRows, "pro_required_households"));
  const devicePoints = fillDays(days, toDayMap(wallRows, "device_limit_households"), toDayMap(snapRows, "device_limit_households"));
  const errorRows = aggregateErrors(data.errors);
  const leadRows = data.leads as Lead[];

  const todayKey = utcDayKey(today);
  const todayActive = activePoints[activePoints.length - 1].value;
  const yesterdayActive = activePoints[activePoints.length - 2]?.value ?? 0;
  const avg7 = average(activePoints.slice(-7));
  const total5xx = errorRows.filter((e) => e.status >= 500).reduce((s, e) => s + e.hits, 0);
  const total4xx = errorRows.filter((e) => e.status < 500).reduce((s, e) => s + e.hits, 0);

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
          Households that hit a free-tier wall, most recent first. Look the owner up in Supabase by id.
        </p>
        {leadRows.length === 0 ? (
          <p className="font-sans text-sm text-ink-soft">No wall hits recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] font-sans text-xs text-ink-soft">
              <thead>
                <tr className="text-left text-ink/60">
                  <th className="py-1 pr-3 font-normal">Household</th>
                  <th className="py-1 pr-3 font-normal">Tier</th>
                  <th className="py-1 pr-3 font-normal">Wall</th>
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

      <section className="rounded-2xl border-2 border-ink/20 bg-porcelain p-4">
        <h2 className="font-marker text-base text-ink">API errors, last 7 days</h2>
        <p className="mb-3 font-sans text-xs text-ink/60">
          {total5xx} server errors (alerted in Slack) · {total4xx} client errors (counted only)
        </p>
        {errorRows.length === 0 ? (
          <p className="font-sans text-sm text-ink-soft">No errors recorded.</p>
        ) : (
          <table className="w-full font-sans text-xs text-ink-soft">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="py-1 font-normal">Route</th>
                <th className="py-1 font-normal">Method</th>
                <th className="py-1 text-right font-normal">Status</th>
                <th className="py-1 text-right font-normal">Hits</th>
              </tr>
            </thead>
            <tbody>
              {errorRows.slice(0, 40).map((e) => (
                <tr key={`${e.method} ${e.route} ${e.status}`} className="border-t border-ink/10">
                  <td className="py-1 font-mono">{e.route}</td>
                  <td className="py-1">{e.method}</td>
                  <td className="py-1 text-right tabular-nums">{e.status}</td>
                  <td className="py-1 text-right tabular-nums">{e.hits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
