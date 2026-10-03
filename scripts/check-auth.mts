#!/usr/bin/env node --experimental-strip-types
//
// Sign-in gate + throttle checks.
//
// Usage:
//   node --experimental-strip-types scripts/check-auth.mts
//   npm run check:auth

import { adminConfigured, checkAdminToken, isValidSession, makeSession, SESSION_MS } from "../src/lib/admin-auth.ts";
import { clearFailures, isBlocked, recordFailure } from "../src/lib/rate-limit.ts";

let failures = 0;
let checks = 0;
function ck(name: string, got: unknown, want: unknown) {
  checks++;
  if (got === want) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}\n       expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}

const TOKEN = "a".repeat(40);
delete process.env.ADMIN_TOKEN;
ck("unset token => not configured", adminConfigured(), false);
ck("unset token => no session can be made", makeSession(), null);
ck("unset token => login refused", checkAdminToken(""), false);

process.env.ADMIN_TOKEN = "short";
ck("short token => not configured", adminConfigured(), false);

process.env.ADMIN_TOKEN = TOKEN;
ck("long token => configured", adminConfigured(), true);
ck("right token accepted", checkAdminToken(TOKEN), true);
ck("wrong token rejected", checkAdminToken("b".repeat(40)), false);
ck("empty token rejected", checkAdminToken(""), false);

const now = 1_000_000;
const session = makeSession(now)!;
ck("fresh session valid", isValidSession(session, now + 1000), true);
ck("session valid just before expiry", isValidSession(session, now + SESSION_MS - 1), true);
ck("session expired", isValidSession(session, now + SESSION_MS + 1), false);
ck("missing cookie invalid", isValidSession(undefined, now), false);
ck("garbage cookie invalid", isValidSession("nope", now), false);
const [exp, sig] = session.split(".");
ck("tampered expiry invalid", isValidSession(`${Number(exp) + 999999}.${sig}`, now), false);
ck("tampered signature invalid", isValidSession(`${exp}.${"0".repeat(sig.length)}`, now), false);
process.env.ADMIN_TOKEN = "c".repeat(40);
ck("rotating the token revokes sessions", isValidSession(session, now + 1000), false);

clearFailures("ip");
for (let i = 0; i < 4; i++) recordFailure("ip", now);
ck("4 failures: not blocked", isBlocked("ip", now), false);
recordFailure("ip", now);
ck("5 failures: blocked", isBlocked("ip", now), true);
ck("other address unaffected", isBlocked("other", now), false);
ck("block lifts after the window", isBlocked("ip", now + 16 * 60 * 1000), false);
recordFailure("ip2", now); clearFailures("ip2");
ck("success clears failures", isBlocked("ip2", now), false);

console.log("");
if (failures > 0) {
  console.log(`  ${checks - failures}/${checks} checks passed -- ${failures} FAILED`);
  process.exit(1);
}
console.log(`  ${checks}/${checks} checks passed`);
