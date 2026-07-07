"use client";

import { Sparkles } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type RegenerateState,
  regenerateMetadataAction,
  type UpdateMetaState,
  updateMetadataAction,
} from "../../actions";

// Owner-only metadata editor (PLAN §5.1). Pre-filled with the current values; any
// field still holding its AI suggestion is badged "suggested" so the owner knows
// to confirm it. Saving posts to updateMetadataAction; once a field is edited its
// badge disappears (the page recomputes suggested-ness against the stored value).
export function MetadataEditor({
  artifactId,
  title,
  description,
  tags,
  suggested,
}: {
  artifactId: string;
  title: string;
  description: string;
  tags: string[];
  suggested: { title: boolean; description: boolean; tags: boolean };
}) {
  const [state, action, pending] = useActionState<UpdateMetaState, FormData>(
    updateMetadataAction,
    {},
  );
  const anySuggested = suggested.title || suggested.description || suggested.tags;

  // Mutation feedback via toast (Phase 6.1: every mutation gets one). useActionState
  // returns the same state object per dispatch, so effect-on-state fires once per save.
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.ok) toast.success("Details saved");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{anySuggested ? "Review AI suggestions" : "Edit details"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={artifactId} />

          <Field id="meta-title" label="Title" suggested={suggested.title}>
            <Input id="meta-title" name="title" defaultValue={title} maxLength={80} />
          </Field>
          <Field id="meta-description" label="Description" suggested={suggested.description}>
            <Textarea
              id="meta-description"
              name="description"
              defaultValue={description}
              maxLength={280}
              rows={3}
            />
          </Field>
          <Field
            id="meta-tags"
            label="Tags"
            suggested={suggested.tags}
            hint="Comma-separated, up to 5"
          >
            <Input id="meta-tags" name="tags" defaultValue={tags.join(", ")} />
          </Field>

          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save details"}
          </Button>
        </form>

        <RegenerateButton artifactId={artifactId} />
      </CardContent>
    </Card>
  );
}

// Re-run Feature A (PLAN Phase 6.6): fresh suggestions replace the fields and
// show as "suggested" again — the owner reviews/edits exactly like publish-time.
function RegenerateButton({ artifactId }: { artifactId: string }) {
  const [state, action, pending] = useActionState<RegenerateState, FormData>(
    regenerateMetadataAction,
    {},
  );
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.ok) toast.success("Fresh suggestions applied — review and save edits");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="mt-3 border-t pt-3">
      <input type="hidden" name="id" value={artifactId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} className="w-full">
        <Sparkles /> {pending ? "Generating…" : "Re-run AI suggestions"}
      </Button>
      <p className="text-muted-foreground mt-1 text-center text-xs">
        Replaces title, description, and tags with fresh suggestions.
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  suggested,
  hint,
  children,
}: {
  id: string;
  label: string;
  suggested: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {suggested ? (
          <Badge variant="secondary" className="text-primary gap-0.5 text-[10px]">
            <Sparkles className="size-2.5" /> suggested
          </Badge>
        ) : null}
        {hint ? <span className="text-muted-foreground ml-auto text-xs">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
