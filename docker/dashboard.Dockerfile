# T-026AB: canonical Next.js production deployment for App Router monorepos.
#
# - Builder stage installs all dependencies (including devDeps), compiles the
#   workspace packages, then runs `next build`. With
#   `output: "standalone"` Next produces a self-contained bundle at
#   `apps/dashboard/.next/standalone/`.
# - Runtime stage copies only the standalone bundle + the static assets that
#   the standalone tracer does not include (the `.next/static` chunks and
#   `public/`). No yarn, no source, no devDeps live in the runtime image.
# - PID 1 is plain `node apps/dashboard/server.js` so signals + healthchecks
#   reach the actual server, image size drops to ~300-400 MB, and there is
#   no per-poll wrapper overhead.

# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:25.2.1-bookworm-slim AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN yarn install --frozen-lockfile

# Workspace packages must be compiled before Next sees them so the standalone
# tracer can pick up the emitted `dist/` files when @bizdev/db or
# @bizdev/shared are imported. transpilePackages handles the source-side
# rewrite for Next itself.
RUN yarn workspace @bizdev/shared build \
  && yarn workspace @bizdev/db build \
  && yarn workspace @bizdev/dashboard build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:25.2.1-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next standalone writes server.js + a minimal pruned node_modules into
# .next/standalone/. With `outputFileTracingRoot` set to the monorepo root the
# tree under .next/standalone/ mirrors the monorepo layout, so we copy the
# whole thing at /app/. Static chunks and public assets are excluded from the
# standalone bundle by design and need to be copied explicitly.
COPY --from=builder /app/apps/dashboard/.next/standalone/ ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
# No `public/` in this project — skip the COPY that ships static assets in
# the canonical Next standalone Dockerfile. Add it back if/when one appears.

# packages/db/src/schema-compatibility.ts does a runtime `readdir` of the
# drizzle migrations directory (its checksum verifies that DB is at the
# expected schema). The Next standalone tracer cannot see this dynamic fs
# access so the migration files are dropped from the bundle. Ship them
# explicitly at the same `outputFileTracingRoot`-relative path the source
# expects: `/app/packages/db/drizzle/`.
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle

USER node

EXPOSE 3000

CMD ["node", "apps/dashboard/server.js"]
