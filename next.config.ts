import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `postgres` (postgres.js) is a server-only dependency; keep it out of the
  // client/edge bundle.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
