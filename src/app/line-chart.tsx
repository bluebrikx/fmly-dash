import { niceMax, ROUTE_OTHER_KEY, type RouteSeries } from "@/lib/metrics";

// Multi-series line chart as inline SVG: errors per day, one line per route.
// Series colors are the first five slots of the reference categorical palette,
// in fixed order, validated against this page's background (#fffcf6) with
// validate_palette.js: every adjacent pair clears the colour-blind and
// normal-vision floors. Three of those hues sit under 3:1 contrast on the
// light surface, so the relief rule applies: the legend (with totals) and the
// "View as table" fallback carry every value. The "Other" bucket is a neutral
// gray. Lines are 2px with round joins; points are 8px dots with a 2px surface
// ring; grid is hairline. Hover (native SVG <title>) lists every route's count
// for that day.

const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const OTHER_COLOR = "#8c857a";
const SURFACE = "#fffcf6";

const W = 720;
const H = 250;
const M = { top: 16, right: 14, bottom: 24, left: 34 };

export function seriesColor(series: RouteSeries, index: number): string {
  return series.key === ROUTE_OTHER_KEY ? OTHER_COLOR : COLORS[index % COLORS.length];
}

export function LineChart({
  title,
  note,
  series,
}: {
  title: string;
  note: string;
  series: RouteSeries[];
}) {
  const days = series[0]?.points.map((p) => p.day) ?? [];
  const peak = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const max = niceMax(peak);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const base = M.top + plotH;
  const x = (i: number) => M.left + (days.length > 1 ? (i * plotW) / (days.length - 1) : plotW / 2);
  const y = (v: number) => base - (v / max) * plotH;
  const ticks = [0, max / 2, max].filter((t, i, a) => Number.isInteger(t) && a.indexOf(t) === i);
  const slot = days.length > 1 ? plotW / (days.length - 1) : plotW;

  return (
    <figure className="mb-4 rounded-2xl border-2 border-ink/20 bg-porcelain p-4">
      <figcaption className="mb-2">
        <span className="font-marker text-base text-ink">{title}</span>
        <span className="ml-2 font-sans text-xs text-ink/60">{note}</span>
      </figcaption>

      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs text-ink-soft">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="22" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="22" y2="5" stroke={seriesColor(s, i)} strokeWidth="2" strokeLinecap="round" />
              <circle cx="11" cy="5" r="4" fill={seriesColor(s, i)} stroke={SURFACE} strokeWidth="2" />
            </svg>
            <span className={s.key === ROUTE_OTHER_KEY ? "" : "font-mono"}>{s.label}</span>
            <span className="tabular-nums text-ink/50">{s.total}</span>
          </li>
        ))}
      </ul>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}. ${series.length} series over ${days.length} days; peak ${peak} errors in a day.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--ink)" strokeOpacity={t === 0 ? 0.35 : 0.1} strokeWidth={1} />
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-soft)">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => (
          <text key={d} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} fontSize={10.5} fill="var(--ink-soft)">
            {d.slice(5)}
          </text>
        ))}
        {series.map((s, si) => (
          <g key={s.key}>
            <polyline
              fill="none"
              stroke={seriesColor(s, si)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
            />
            {s.points.map((p, i) => (
              <circle key={p.day} cx={x(i)} cy={y(p.value)} r={4} fill={seriesColor(s, si)} stroke={SURFACE} strokeWidth={2} />
            ))}
          </g>
        ))}
        {days.map((d, i) => (
          <rect key={d} x={x(i) - slot / 2} y={M.top} width={slot} height={plotH} fill="transparent">
            <title>{`${d}\n${series.map((s) => `${s.label}: ${s.points[i].value}`).join("\n")}`}</title>
          </rect>
        ))}
      </svg>

      <details className="mt-1">
        <summary className="cursor-pointer font-sans text-xs text-ink/60">View as table</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full font-sans text-xs text-ink-soft">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="py-1 pr-3 font-normal">Day (UTC)</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 pr-3 text-right font-mono font-normal">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => {
                const i = days.indexOf(d);
                return (
                  <tr key={d} className="border-t border-ink/10">
                    <td className="py-1 pr-3 tabular-nums">{d}</td>
                    {series.map((s) => (
                      <td key={s.key} className="py-1 pr-3 text-right tabular-nums">
                        {s.points[i].value}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
