"use client";

import { Trash2 } from "lucide-react";
import { deleteArtifactAction } from "../../actions";

export function DeleteArtifactButton({ id }: { id: string }) {
  return (
    <form
      action={deleteArtifactAction}
      onSubmit={(e) => {
        if (!confirm("Delete this artifact? This cannot be undone.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-destructive border-destructive/30 hover:bg-destructive/10 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors"
      >
        <Trash2 className="size-4" /> Delete
      </button>
    </form>
  );
}
