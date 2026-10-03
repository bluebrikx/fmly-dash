"use client";

import { useActionState } from "react";
import { adminLogin, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(adminLogin, { error: null });
  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 font-sans text-sm text-ink-soft">
        Admin token
        <input
          name="token"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-lg border-2 border-ink px-3 py-2 font-sans text-ink"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg border-2 border-ink bg-mustard px-4 py-2 font-marker text-ink transition active:translate-y-0.5 disabled:opacity-40"
      >
        {pending ? "Checking..." : "Sign in"}
      </button>
      {state.error && <p className="font-sans text-sm text-diner-red">{state.error}</p>}
    </form>
  );
}
