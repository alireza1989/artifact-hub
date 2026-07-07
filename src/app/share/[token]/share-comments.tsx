"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { numberImagePins, pinNumberFor } from "@/components/feedback/anchor-utils";
import {
  CommentAnchorChip,
  PendingAnchorField,
  useAnchorCompose,
} from "@/components/feedback/anchors";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Comment } from "@/db/schema";
import { formatDate } from "@/lib/format";
import type { CommentAnchor } from "@/lib/validation";
import { AUTHOR_NAME_MAX, COMMENT_BODY_MAX } from "@/lib/validation";
import { submitShareComment } from "./actions";

type DisplayComment = {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date | string;
  anchor?: CommentAnchor | null;
  pending?: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// Read-only-except-commenting feedback panel for the share view. Comments append
// optimistically so an external reviewer sees their note land instantly; on a
// server error the optimistic entry reverts and the error shows (PLAN §7).
// Phase 6.4/6.9: comments may carry an anchor (text quote / image pin) picked up
// from the AnchorCompose context that AnchoredPreview fills.
export function ShareComments({ token, comments }: { token: string; comments: Comment[] }) {
  const [optimistic, addOptimistic] = useOptimistic<DisplayComment[], DisplayComment>(
    comments,
    (current, next) => [next, ...current],
  );
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const compose = useAnchorCompose();

  // Pin numbers must match the preview's markers, which render from the
  // server-provided comments — exclude the optimistic pending entry or every
  // chip shifts by one against the visible markers until revalidation lands.
  const pins = numberImagePins(optimistic.filter((c) => !c.pending));

  function onSubmit(formData: FormData) {
    const authorName = String(formData.get("authorName") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    if (!authorName || !body) {
      setError("Add your name and a comment.");
      return;
    }
    setError(undefined);
    const anchor = compose?.pending ?? null;
    startTransition(async () => {
      addOptimistic({
        id: `optimistic-${Date.now()}`,
        authorName,
        body,
        anchor,
        createdAt: new Date(),
        pending: true,
      });
      const res = await submitShareComment(formData);
      if (res.error) {
        // Keep the typed comment + captured anchor so a rate-limit or expired
        // link doesn't destroy the reviewer's work (review 2026-07-07); the
        // optimistic entry reverts on its own.
        setError(res.error);
        toast.error(res.error);
      } else {
        formRef.current?.reset();
        compose?.setPending(null);
        toast.success("Comment posted");
      }
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">
        Feedback{optimistic.length > 0 ? ` (${optimistic.length})` : ""}
      </h2>

      <form ref={formRef} action={onSubmit} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        {/* Honeypot — hidden from humans, tempting to bots. Kept out of the tab order. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <PendingAnchorField />
        <Input
          name="authorName"
          required
          maxLength={AUTHOR_NAME_MAX}
          placeholder="Your name"
          aria-label="Your name"
        />
        <Textarea
          name="body"
          required
          maxLength={COMMENT_BODY_MAX}
          rows={3}
          placeholder="Leave a comment"
          aria-label="Your comment"
        />
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={isPending}>
          {isPending ? "Posting…" : "Post comment"}
        </Button>
      </form>

      {optimistic.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          No feedback yet — be the first to comment.
        </p>
      ) : (
        <ul className="space-y-3">
          {optimistic.map((comment) => (
            <li key={comment.id} id={`c-${comment.id}`} className="scroll-mt-20">
              <Card
                size="sm"
                className={`flex-row gap-3 px-4 ${comment.pending ? "opacity-60" : ""}`}
              >
                <Avatar className="mt-0.5 size-7">
                  <AvatarFallback className="bg-accent text-accent-foreground text-[10px] font-semibold">
                    {initials(comment.authorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{comment.authorName}</span>
                    <span className="text-muted-foreground text-xs">
                      {comment.pending ? "Posting…" : formatDate(comment.createdAt)}
                    </span>
                  </div>
                  {comment.anchor ? (
                    <div className="mt-1">
                      <CommentAnchorChip
                        anchor={comment.anchor}
                        commentId={comment.id}
                        pinNumber={pinNumberFor(pins, comment.id)}
                      />
                    </div>
                  ) : null}
                  <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
