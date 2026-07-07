"use client";

import { useState } from "react";
import { toast } from "sonner";
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

// One confirm-dialog-wrapped destructive form action for all admin tables
// (delete artifact / revoke link / delete comment). The server action revalidates
// its admin path, so the row disappears on completion.
export function ConfirmActionButton({
  action,
  fields,
  trigger,
  title,
  description,
  confirmLabel,
  successToast,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  trigger: string;
  title: string;
  description: string;
  confirmLabel: string;
  successToast: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="xs">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <form
            action={async (formData) => {
              setPending(true);
              try {
                await action(formData);
                toast.success(successToast);
                setOpen(false);
              } finally {
                setPending(false);
              }
            }}
          >
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
