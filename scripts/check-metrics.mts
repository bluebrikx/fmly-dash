#!/usr/bin/env node --experimental-strip-types
//
// Dashboard helpers (PLAN.md Phase 11).
//
// Usage:
//   node --experimental-strip-types scripts/check-metrics.mts
//   npm run check:metrics

import {
  lastDays, fillDays, toDayMap, niceMax, average,
  parseErrorQuery, applyErrorQuery, errorFilterOptions, errorQueryHref, nextSort, DEFAULT_ERROR_QUERY,
} from "../src/lib/metrics.ts";

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
const ROWS = [
  { day: "2026-10-01", route: "/api/sync/write", method: "POST", status: 401, hits: 5 },
  { day: "2026-10-02", route: "/api/sync/write", method: "POST", status: 402, hits: 9 },
  { day: "2026-10-02", route: "/api/boards/request", method: "POST", status: 500, hits: 1 },
  { day: "2026-10-03", route: "/api/sync/read", method: "GET", status: 401, hits: 2 },
  { day: "2026-10-03", route: "/api/sync/write", method: "POST", status: 401, hits: 7 },
];
const Q = DEFAULT_ERROR_QUERY;
const dayOf = (rows: { day: string }[]) => rows.map((r) => r.day);
const hits = (rows: { hits: number }[]) => rows.map((r) => r.hits);
ck("default order: newest day first, then most errors", hits(applyErrorQuery([...ROWS], Q)), [7, 2, 9, 1, 5]);
ck("sort by date ascending", dayOf(applyErrorQuery([...ROWS], { ...Q, dir: "asc" })), ["2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03", "2026-10-03"]);
ck("sort by errors descending", hits(applyErrorQuery([...ROWS], { ...Q, sort: "hits", dir: "desc" })), [9, 7, 5, 2, 1]);
ck("sort by errors ascending", hits(applyErrorQuery([...ROWS], { ...Q, sort: "hits", dir: "asc" })), [1, 2, 5, 7, 9]);
ck("filter by route substring (case-insensitive)", applyErrorQuery([...ROWS], { ...Q, route: "SYNC" }).length, 4);
ck("filter by method", applyErrorQuery([...ROWS], { ...Q, method: "GET" }).length, 1);
ck("filter by exact status", applyErrorQuery([...ROWS], { ...Q, status: "401" }).length, 3);
ck("filter by 5xx class", applyErrorQuery([...ROWS], { ...Q, status: "5xx" }).length, 1);
ck("filter by 4xx class", applyErrorQuery([...ROWS], { ...Q, status: "4xx" }).length, 4);
ck("filters combine (AND)", applyErrorQuery([...ROWS], { ...Q, route: "write", status: "401" }).length, 2);
ck("no match gives empty", applyErrorQuery([...ROWS], { ...Q, route: "nope" }).length, 0);
ck("filtering does not mutate the input order", ROWS[0].day, "2026-10-01");
ck("filter options", errorFilterOptions(ROWS), { methods: ["GET", "POST"], statuses: [401, 402, 500] });
ck("parse: defaults for empty params", parseErrorQuery({}), Q);
ck("parse: valid params", parseErrorQuery({ route: " /api ", method: "post", status: "5XX", sort: "hits", dir: "asc" }), { route: "/api", method: "POST", status: "5xx", sort: "hits", dir: "asc" });
ck("parse: junk falls back", parseErrorQuery({ method: "PO ST;", status: "99999", sort: "drop table", dir: "up" }), Q);
ck("parse: array params use the first value", parseErrorQuery({ status: ["401", "500"] }).status, "401");
ck("parse: route is capped at 100 chars", parseErrorQuery({ route: "x".repeat(300) }).route.length, 100);
ck("nextSort flips the same column", nextSort(Q, "day"), { sort: "day", dir: "asc" });
ck("nextSort starts a new column descending", nextSort(Q, "hits"), { sort: "hits", dir: "desc" });
ck("href omits defaults", errorQueryHref(Q), "/#api-errors");
ck("href keeps filters and sort", errorQueryHref({ ...Q, route: "/api/x y", status: "4xx" }, { sort: "hits", dir: "asc" }), "/?route=%2Fapi%2Fx+y&status=4xx&sort=hits&dir=asc#api-errors");
ck("average of empty is 0", average([]), 0);
ck("average", average([{ day: "a", value: 1 }, { day: "b", value: 2 }]), 1.5);

console.log("");
if (failures > 0) {
  console.log(`  ${checks - failures}/${checks} checks passed -- ${failures} FAILED`);
  process.exit(1);
}
console.log(`  ${checks}/${checks} checks passed`);
