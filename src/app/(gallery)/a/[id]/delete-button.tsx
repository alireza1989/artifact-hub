"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteArtifactAction } from "../../actions";

// Destructive action behind an explicit confirm dialog (was a native confirm()).
// The action redirects to the gallery on success — navigation is the feedback.
export function DeleteArtifactButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" className="w-full">
          <Trash2 /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete this artifact?</DialogTitle>
          <DialogDescription>
            The artifact, its share links, and all feedback will be permanently removed. This cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <form action={deleteArtifactAction} onSubmit={() => setPending(true)}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Deleting…" : "Delete artifact"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
