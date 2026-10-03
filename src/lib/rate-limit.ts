// In-memory sign-in throttle, keyed by client address. This lives in one
// server instance only: serverless deployments run many, so it slows casual
// guessing but is NOT a real lockout. The real defences are a long random
// ADMIN_TOKEN and platform rate limiting / deployment protection (README).

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

export function isBlocked(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (now - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(key: string, now = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else entry.count += 1;
  if (attempts.size > 1000) {
    for (const [k, v] of attempts) if (now - v.first > WINDOW_MS) attempts.delete(k);
  }
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
