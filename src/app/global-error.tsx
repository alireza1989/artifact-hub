"use client";

import { useEffect } from "react";

// Last-resort boundary if the root layout itself throws (PLAN §6). It replaces the
// whole document, so it must render its own <html>/<body>. Kept dependency-free
// and self-styled — the app CSS may be what failed. Digest shown + logged so a
// production report is correlatable with the server log (see (gallery)/error.tsx).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[artifact-hub] fatal error${error.digest ? ` digest=${error.digest}` : ""}`);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
            The app hit an unexpected error. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              borderRadius: "0.5rem",
              border: "1px solid #cbd5e1",
              padding: "0.5rem 1rem",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "1rem" }}>
              Error code: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
