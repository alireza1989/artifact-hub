"use client";

import { Sparkles } from "lucide-react";
import { useActionState } from "react";
import { type UpdateMetaState, updateMetadataAction } from "../../actions";

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

  return (
    <form action={action} className="border-border bg-card space-y-3 rounded-lg border p-4">
      <p className="text-sm font-semibold">
        {anySuggested ? "Review AI suggestions" : "Edit details"}
      </p>
      <input type="hidden" name="id" value={artifactId} />

      <Field label="Title" suggested={suggested.title}>
        <input name="title" defaultValue={title} maxLength={80} className={inputClass} />
      </Field>
      <Field label="Description" suggested={suggested.description}>
        <textarea
          name="description"
          defaultValue={description}
          maxLength={280}
          rows={3}
          className={inputClass}
        />
      </Field>
      <Field label="Tags" suggested={suggested.tags} hint="Comma-separated, up to 5">
        <input name="tags" defaultValue={tags.join(", ")} className={inputClass} />
      </Field>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}

function Field({
  label,
  suggested,
  hint,
  children,
}: {
  label: string;
  suggested: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children.
    <label className="block space-y-1">
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        {suggested ? (
          <span className="bg-primary/10 text-primary inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
            <Sparkles className="size-2.5" /> suggested
          </span>
        ) : null}
        {hint ? <span className="text-muted-foreground ml-auto text-xs">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "border-border bg-background focus-visible:ring-3 focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-2 text-sm outline-none";
