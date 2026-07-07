import { Clock, LinkIcon, ShieldOff } from "lucide-react";

type Reason = "invalid" | "expired" | "revoked";

// Friendly, non-alarming explanation for a link that didn't resolve — never a 404 or
// stack trace, which read as "broken" to a non-technical reviewer (PLAN §7).
//
// Privacy: we deliberately distinguish expired vs. revoked vs. invalid. This leaks
// no "was this token ever real?" signal, because `verifyShareToken` only returns
// `expired`/`revoked` AFTER the constant-time HMAC signature check passes — i.e.
// only a holder of a validly-signed token (which requires SHARE_LINK_SECRET) can
// ever reach those branches. Anyone guessing or tampering only ever gets the
// ambiguous `invalid`, which conflates never-existed + forged + tampered + missing
// artifact and confirms nothing. See PLAN Decision Log 2026-07-06.
const COPY: Record<Reason, { icon: typeof Clock; title: string; body: string }> = {
  expired: {
    icon: Clock,
    title: "This link has expired",
    body: "Share links are time-limited. Ask the person who sent it to share a new one.",
  },
  revoked: {
    icon: ShieldOff,
    title: "This link has been turned off",
    body: "Its owner turned off access to this link. Ask them for a new one if you still need it.",
  },
  invalid: {
    icon: LinkIcon,
    title: "This link isn’t valid",
    body: "Double-check you copied the whole link, or ask the sender to share it again.",
  },
};

export function ShareState({ reason }: { reason: Reason }) {
  const { icon: Icon, title, body } = COPY[reason];
  return (
    <div className="border-border bg-card mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-10 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Icon className="size-6" />
      </div>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">{body}</p>
    </div>
  );
}
