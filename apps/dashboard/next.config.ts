import type { NextConfig } from "next";
import path from "node:path";

// T-026AB: `output: "standalone"` is the canonical Next.js production target.
// At build time Next traces every runtime dependency (including the workspace
// packages picked up by `transpilePackages`) and copies them into
// `.next/standalone/`, producing a self-contained bundle that runs as
// `node apps/dashboard/server.js` with no yarn / source / devDeps in the
// container. `outputFileTracingRoot` must point at the monorepo root so the
// tracer follows hoisted node_modules and our workspace packages — otherwise
// it stops at `apps/dashboard/` and the standalone bundle ships broken.
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@bizdev/db", "@bizdev/shared"]
};

export default nextConfig;
