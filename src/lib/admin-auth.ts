import { createHmac, timingSafeEqual } from "node:crypto";

// Gate for the whole dashboard. One shared ADMIN_TOKEN; a successful sign-in
// sets an httpOnly cookie "<expiresAtMs>.<hmac>" where the HMAC (keyed by the
// token) covers the expiry. The server checks both, so a session expires even
// if the cookie lives on, and changing ADMIN_TOKEN revokes every session at
// once. Fails closed: no (or a short) token means nobody gets in.

export const COOKIE_NAME = "fmly_dash";
export const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
export const MIN_TOKEN_LENGTH = 32;

function mac(label: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(label).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function token(): string | null {
  const t = process.env.ADMIN_TOKEN;
  return t && t.length >= MIN_TOKEN_LENGTH ? t : null;
}

export function adminConfigured(): boolean {
  return token() !== null;
}

export function checkAdminToken(candidate: string): boolean {
  const t = token();
  if (!t) return false;
  return safeEqual(mac("login", t), mac("login", candidate));
}

export function makeSession(now = Date.now()): string | null {
  const t = token();
  if (!t) return null;
  const exp = String(now + SESSION_MS);
  return `${exp}.${mac(`session:${exp}`, t).toString("hex")}`;
}

export function isValidSession(value: string | undefined, now = Date.now()): boolean {
  const t = token();
  if (!t || !value) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) <= now) return false;
  return safeEqual(Buffer.from(mac(`session:${exp}`, t).toString("hex")), Buffer.from(sig));
}
