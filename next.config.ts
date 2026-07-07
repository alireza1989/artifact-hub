import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `postgres` (postgres.js) is a server-only dependency; keep it out of the
  // client/edge bundle.
  serverExternalPackages: ["postgres"],
  experimental: {
    // The web publish form uploads via a Server Action, whose body defaults to a
    // 1 MB cap — smaller than the gallery's advertised limit, so larger uploads
    // 500 before the handler runs. Raise it to just under Vercel's ~4.5 MB
    // function-body cap. (Uploads beyond this need client-direct-to-Blob — a
    // deferred follow-up; see the Decision Log's 2026-07-06 size-handling entry.)
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
