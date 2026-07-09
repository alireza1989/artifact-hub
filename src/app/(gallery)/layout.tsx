import { Cable, LockKeyhole, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { hasValidSession } from "@/lib/auth/session";
import { lockAction } from "./actions";

// Shared chrome for browse / detail / publish (all in the gallery route group).
// The Admin link renders only for an unlocked owner session — visibility only;
// every /admin page still gates itself server-side (PLAN Phase 6.5).
export default async function GalleryLayout({ children }: { children: React.ReactNode }) {
  const isOwner = await hasValidSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="border-border sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <nav
          aria-label="Primary"
          className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3"
        >
          <Link
            href="/"
            className="rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <NavLink href="/connect">
              <Cable /> Connect
            </NavLink>
            {isOwner ? (
              <NavLink href="/admin">
                <Settings2 /> Admin
              </NavLink>
            ) : null}
            <NavLink href="/publish" variant="default">
              <Plus /> Publish
            </NavLink>
            {isOwner ? (
              // Forget the session cookie on this browser (the token stays valid).
              <form action={lockAction}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  title="Lock the hub on this browser"
                  aria-label="Lock the hub on this browser"
                >
                  <LockKeyhole />
                </Button>
              </form>
            ) : null}
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
