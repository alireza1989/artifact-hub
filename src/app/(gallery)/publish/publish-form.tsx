"use client";

import { UploadCloud } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { type FormState, publishAction } from "../actions";

export function PublishForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(publishAction, {});
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function adopt(files: FileList | null) {
    const file = files?.[0];
    if (!file || !inputRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    inputRef.current.files = dt.files;
    setFileName(`${file.name || "untitled"} · ${formatBytes(file.size)}`);
  }

  function onPaste(e: React.ClipboardEvent) {
    if (e.clipboardData.files.length > 0) {
      adopt(e.clipboardData.files);
      return;
    }
    const text = e.clipboardData.getData("text");
    if (text && !fileName) {
      const dt = new DataTransfer();
      dt.items.add(new File([text], "pasted.txt", { type: "text/plain" }));
      if (inputRef.current) inputRef.current.files = dt.files;
      setFileName(`pasted.txt · ${formatBytes(text.length)}`);
    }
  }

  return (
    <form
      action={action}
      onPaste={onPaste}
      className="space-y-5"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        adopt(e.dataTransfer.files);
      }}
    >
      <label
        className={`border-border hover:bg-muted/40 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragging ? "border-primary bg-muted/40" : ""
        }`}
      >
        <UploadCloud className="text-muted-foreground size-8" />
        <span className="text-sm font-medium">
          {fileName ?? "Drag & drop, paste, or click to choose a file"}
        </span>
        <span className="text-muted-foreground text-xs">Up to 25 MB · any file type</span>
        <input
          ref={inputRef}
          type="file"
          name="file"
          className="sr-only"
          onChange={(e) => adopt(e.target.files)}
        />
      </label>

      <div className="space-y-3">
        <Field label="Title" hint="Leave blank to use the filename">
          <input name="title" maxLength={80} className={inputClass} placeholder="Optional" />
        </Field>
        <Field label="Description">
          <textarea
            name="description"
            maxLength={280}
            rows={3}
            className={inputClass}
            placeholder="Optional"
          />
        </Field>
        <Field label="Tags" hint="Comma-separated, up to 5">
          <input name="tags" className={inputClass} placeholder="e.g. design, report" />
        </Field>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Publishing…" : "Publish artifact"}
      </Button>
    </form>
  );
}

const inputClass =
  "border-border bg-background focus-visible:ring-3 focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-2 text-sm outline-none";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children.
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
