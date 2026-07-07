"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type FormState, unlockAction } from "../actions";

export function UnlockForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(unlockAction, {});

  // Success redirects to /publish; only failures need feedback here.
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="team-token">Team token</Label>
        <Input
          id="team-token"
          type="password"
          name="token"
          autoComplete="off"
          placeholder="Enter your team token"
        />
      </div>
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
