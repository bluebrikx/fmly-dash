"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, SESSION_MS, checkAdminToken, makeSession } from "@/lib/admin-auth";
import { clearFailures, isBlocked, recordFailure } from "@/lib/rate-limit";

export type LoginState = { error: string | null };

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function adminLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const key = await clientKey();
  if (isBlocked(key)) return { error: "Too many attempts. Try again later." };

  const candidate = String(formData.get("token") ?? "");
  const session = makeSession();
  if (!session || !checkAdminToken(candidate)) {
    recordFailure(key);
    // Fixed delay on every failure (not growing, so it can't be abused to lock out the owner).
    await new Promise((r) => setTimeout(r, 1000));
    return { error: "That token didn't work." };
  }
  clearFailures(key);
  (await cookies()).set(COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(SESSION_MS / 1000),
  });
  redirect("/");
}

export async function adminLogout(): Promise<void> {
  (await cookies()).delete({ name: COOKIE_NAME, path: "/" });
  redirect("/");
}
