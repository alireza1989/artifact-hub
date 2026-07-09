"use client";

import { UploadCloud } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/format";
import { type FormState, publishAction } from "../actions";

export function PublishForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(publishAction, {});
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Publish success redirects to the artifact page (navigation is the feedback);
  // failures surface both inline and as a toast (Phase 6.1: every mutation).
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.error) toast.error(state.error);
  }, [state]);

  // Web publish rides a Server Action capped at 4mb (next.config bodySizeLimit);
  // reject oversized files here instead of uploading fully into an opaque Next
  // error. Headroom covers multipart framing + the metadata fields. The REST/MCP
  // paths (25 MB cap) are unaffected.
  const WEB_UPLOAD_MAX = 4 * 1024 * 1024 - 64 * 1024;

  function adopt(files: FileList | null) {
    const file = files?.[0];
    if (!file || !inputRef.current) return;
    if (file.size > WEB_UPLOAD_MAX) {
      toast.error(
        `"${file.name || "That file"}" is ${formatBytes(file.size)} — web publishing caps at 4 MB. ` +
          "Publish bigger files (up to 25 MB) via the REST API or MCP.",
      );
      return;
    }
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
        className={`border-border bg-card hover:border-primary/40 hover:bg-accent/30 focus-within:ring-3 focus-within:ring-ring/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragging ? "border-primary bg-accent/40" : ""
        }`}
      >
        <span
          className={`bg-accent flex size-12 items-center justify-center rounded-full transition-colors ${dragging ? "text-primary" : "text-accent-foreground"}`}
        >
          <UploadCloud className="size-6" />
        </span>
        <span className="text-sm font-medium">
          {fileName ?? "Drag & drop, paste, or click to choose a file"}
        </span>
        <span className="text-muted-foreground text-xs">
          HTML, images, PDF, Markdown, CSV, JSON… up to 4 MB
        </span>
        <input
          ref={inputRef}
          type="file"
          name="file"
          aria-label="Choose a file to publish"
          className="sr-only"
          onChange={(e) => adopt(e.target.files)}
        />
      </label>

      <div className="space-y-4">
        <Field id="pub-title" label="Title" hint="Blank = written for you from the content">
          <Input id="pub-title" name="title" maxLength={80} placeholder="Optional" />
        </Field>
        <Field id="pub-description" label="Description" hint="Blank = written for you">
          <Textarea
            id="pub-description"
            name="description"
            maxLength={280}
            rows={3}
            placeholder="Optional"
          />
        </Field>
        <Field id="pub-tags" label="Tags" hint="Comma-separated, up to 5">
          <Input id="pub-tags" name="tags" placeholder="e.g. design, report" />
        </Field>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      {/* Disabled until a file is adopted — the server still re-checks, but a
          dead-obvious disabled button beats a round-trip "choose a file" error. */}
      <Button type="submit" size="lg" disabled={pending || !fileName} className="w-full">
        {pending ? "Publishing…" : fileName ? "Publish artifact" : "Choose a file to publish"}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
