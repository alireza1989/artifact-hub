"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyTagMergesAction,
  suggestTagMergesAction,
  type TagApplyState,
  type TagSuggestState,
} from "../actions";

type Merge = { from: string[]; to: string };

// Suggest → review → apply flow (PLAN Phase 6.7). The AI never mutates: the
// owner sees each proposed merge as a checkbox (all on by default), unchecks any
// they disagree with, and applies. Apply posts the approved subset as JSON.
export function TagCleanup() {
  const [suggestState, suggest, suggesting] = useActionState<TagSuggestState, FormData>(
    suggestTagMergesAction,
    {},
  );
  const [applyState, apply, applying] = useActionState<TagApplyState, FormData>(
    applyTagMergesAction,
    {},
  );
  const [approved, setApproved] = useState<Set<number> | null>(null);

  // Fresh suggestions → approve everything by default; errors/none → toast.
  const lastSuggest = useRef(suggestState);
  useEffect(() => {
    if (suggestState === lastSuggest.current) return;
    lastSuggest.current = suggestState;
    if (suggestState.merges) setApproved(new Set(suggestState.merges.map((_, i) => i)));
    else if (suggestState.none) toast.info("Tags already look clean — nothing to merge.");
    else if (suggestState.error) toast.error(suggestState.error);
  }, [suggestState]);

  const lastApply = useRef(applyState);
  useEffect(() => {
    if (applyState === lastApply.current) return;
    lastApply.current = applyState;
    if (applyState.updated !== undefined) {
      toast.success(
        applyState.updated === 0
          ? "Nothing needed updating."
          : `Tags merged across ${applyState.updated} artifact${applyState.updated === 1 ? "" : "s"}`,
      );
      setApproved(null); // suggestions are stale after an apply
    } else if (applyState.error) {
      toast.error(applyState.error);
    }
  }, [applyState]);

  const merges: Merge[] = suggestState.merges ?? [];
  const showReview = approved !== null && merges.length > 0;
  const selected = showReview ? merges.filter((_, i) => approved.has(i)) : [];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="text-primary size-4" /> Tag cleanup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Get merge suggestions for near-duplicate tags (plurals, spelling variants). Nothing
          changes until you review and apply.
        </p>

        <form action={suggest}>
          <Button type="submit" variant="outline" size="sm" disabled={suggesting}>
            {suggesting ? "Analyzing tags…" : "Suggest cleanup"}
          </Button>
        </form>

        {showReview ? (
          <div className="space-y-3">
            <ul className="space-y-2">
              {merges.map((merge, i) => (
                <li key={merge.to + merge.from.join(",")}>
                  <label className="border-border hover:bg-muted/40 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors">
                    <input
                      type="checkbox"
                      checked={approved.has(i)}
                      onChange={(e) => {
                        const next = new Set(approved);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        setApproved(next);
                      }}
                    />
                    <span className="flex flex-wrap items-center gap-1.5">
                      {merge.from.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-muted-foreground">
                          {tag}
                        </Badge>
                      ))}
                      <ArrowRight className="text-muted-foreground size-3.5" />
                      <Badge>{merge.to}</Badge>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <form action={apply}>
              <input type="hidden" name="merges" value={JSON.stringify(selected)} />
              <Button type="submit" size="sm" disabled={applying || selected.length === 0}>
                {applying
                  ? "Applying…"
                  : `Apply ${selected.length} merge${selected.length === 1 ? "" : "s"}`}
              </Button>
            </form>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
