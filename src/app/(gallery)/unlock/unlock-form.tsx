"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type FormState, unlockAction } from "../actions";

export function UnlockForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(unlockAction, {});

  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Team token</span>
        <input
          type="password"
          name="token"
          autoComplete="off"
          className="border-border bg-background focus-visible:ring-3 focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          placeholder="Enter your team token"
        />
      </label>
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Unlocking…" : "Unlock"}
      </Button>
    </form>
  );
}
