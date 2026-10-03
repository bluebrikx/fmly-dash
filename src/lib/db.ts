import { Pool } from "pg";

// Read-only connection (the metrics_reader role). One small pool per server
// instance; serverless instances are short-lived, so keep it tiny.
let pool: Pool | null = null;

export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    const ca = process.env.DATABASE_CA?.replace(/\\n/g, "\n");
    pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 10_000,
      // Verified when a CA is provided; otherwise encrypted but unauthenticated.
      ssl: /localhost|127\.0\.0\.1|%2F/i.test(url)
        ? false
        : ca
          ? { ca, rejectUnauthorized: true }
          : { rejectUnauthorized: false },
    });
  }
  return pool;
}
