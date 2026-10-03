import { niceMax, type DayPoint } from "@/lib/metrics";

// Single-series daily column chart as inline SVG (PLAN.md Phase 11). One series
// per chart, so there is no legend: the title names what is plotted. Marks
// follow the dataviz spec -- <=24px columns with a 4px rounded top, square at
// the baseline, hairline grid, text in text tokens. Hover shows each day's
// value (native SVG <title>); the table view carries every number for anyone
// who can't hover.

const H = 190;
const M = { top: 18, right: 8, bottom: 24, left: 34 };

function column(x: number, w: number, base: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${base} V${base - h + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${base} Z`;
}

export function BarChart({
  title,
  unit,
  points,
  color,
  compact = false,
}: {
  title: string;
  unit: string;
  points: DayPoint[];
  color: string;
  compact?: boolean;
}) {
  // Half-width charts get a narrower canvas so text stays legible when scaled.
  const W = compact ? 400 : 720;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const base = M.top + plotH;
  const slot = plotW / Math.max(points.length, 1);
  const barW = Math.min(24, slot - 2);
  const ticks = [0, max / 2, max].filter((t, i, a) => Number.isInteger(t) && a.indexOf(t) === i);
  const last = points.length - 1;
  const lastTotal = points[last]?.value ?? 0;

  return (
    <figure className="rounded-2xl border-2 border-ink/20 bg-porcelain p-4">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-marker text-base text-ink">{title}</span>
        <span className="font-sans text-xs text-ink/60">
          today {lastTotal} {unit}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}, last ${points.length} days. Today: ${lastTotal} ${unit}. Peak: ${Math.max(0, ...points.map((p) => p.value))}.`}
      >
        {ticks.map((t) => {
          const y = base - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y} y2={y} stroke="var(--ink)" strokeOpacity={t === 0 ? 0.35 : 0.1} strokeWidth={1} />
              <text x={M.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--ink-soft)">
                {t}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const h = (p.value / max) * plotH;
          const x = M.left + i * slot + (slot - barW) / 2;
          const showLabel = i === 0 || i === last || i % 5 === 0;
          return (
            <g key={p.day}>
              {h > 0 && <path d={column(x, barW, base, h)} fill={color} />}
              {i === last && p.value > 0 && (
                <text x={x + barW / 2} y={base - h - 5} textAnchor="middle" fontSize={11} fill="var(--ink)">
                  {p.value}
                </text>
              )}
              {showLabel && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--ink-soft)">
                  {p.day.slice(5)}
                </text>
              )}
              <rect x={M.left + i * slot} y={M.top} width={slot} height={plotH} fill="transparent">
                <title>{`${p.day}: ${p.value} ${unit}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <details className="mt-1">
        <summary className="cursor-pointer font-sans text-xs text-ink/60">View as table</summary>
        <table className="mt-2 w-full font-sans text-xs text-ink-soft">
          <thead>
            <tr className="text-left text-ink/60">
              <th className="py-1 font-normal">Day (UTC)</th>
              <th className="py-1 text-right font-normal">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.day} className="border-t border-ink/10">
                <td className="py-1">{p.day}</td>
                <td className="py-1 text-right tabular-nums">{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
