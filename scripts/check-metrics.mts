#!/usr/bin/env node --experimental-strip-types
//
// Dashboard helpers (PLAN.md Phase 11).
//
// Usage:
//   node --experimental-strip-types scripts/check-metrics.mts
//   npm run check:metrics

import { lastDays, fillDays, toDayMap, niceMax, aggregateErrors, average } from "../src/lib/metrics.ts";

let failures = 0;
let checks = 0;
function ck(name: string, got: unknown, want: unknown) {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}\n       expected ${w}, got ${g}`);
  }
}

const today = new Date("2026-10-03T15:00:00Z");
ck("lastDays is oldest-first and ends today", lastDays(3, today), ["2026-10-01", "2026-10-02", "2026-10-03"]);
ck("lastDays crosses a month boundary", lastDays(2, new Date("2026-11-01T00:30:00Z")), ["2026-10-31", "2026-11-01"]);
const days = lastDays(3, today);
ck("fillDays zero-fills missing days", fillDays(days, { "2026-10-02": 4 }).map((p) => p.value), [0, 4, 0]);
ck("fillDays takes the larger of live vs snapshot", fillDays(days, { "2026-10-01": 2 }, { "2026-10-01": 5 }).map((p) => p.value), [5, 0, 0]);
ck("toDayMap reads a numeric field", toDayMap([{ day: "d1", n: "3" } as { day: string }], "n"), { d1: 3 });
ck("toDayMap treats null as 0", toDayMap([{ day: "d1", n: null } as unknown as { day: string }], "n"), { d1: 0 });
ck("niceMax(0)", niceMax(0), 1);
ck("niceMax(3)", niceMax(3), 5);
ck("niceMax(7)", niceMax(7), 10);
ck("niceMax(10) stays", niceMax(10), 10);
ck("niceMax(11)", niceMax(11), 20);
ck("niceMax(430)", niceMax(430), 500);
ck(
  "aggregateErrors merges days, busiest first",
  aggregateErrors([
    { route: "/a", method: "POST", status: 401, hits: 2 },
    { route: "/a", method: "POST", status: 401, hits: 3 },
    { route: "/b", method: "GET", status: 500, hits: 1 },
  ]),
  [{ route: "/a", method: "POST", status: 401, hits: 5 }, { route: "/b", method: "GET", status: 500, hits: 1 }],
);
ck("average of empty is 0", average([]), 0);
ck("average", average([{ day: "a", value: 1 }, { day: "b", value: 2 }]), 1.5);

console.log("");
if (failures > 0) {
  console.log(`  ${checks - failures}/${checks} checks passed -- ${failures} FAILED`);
  process.exit(1);
}
console.log(`  ${checks}/${checks} checks passed`);
