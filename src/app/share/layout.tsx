// Minimal external-facing shell for the public share viewer. Deliberately NOT the
// gallery chrome: a share-link visitor is a stranger to the team, so there is no
// nav into the app, no publish CTA — just the shared artifact and a wordmark.
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border border-b">
        <div className="mx-auto w-full max-w-4xl px-6 py-3">
          <span className="text-muted-foreground text-sm font-medium tracking-tight">
            Shared via Artifact Hub
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
