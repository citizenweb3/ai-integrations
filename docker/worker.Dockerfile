# T-026AB: multi-stage production build for the worker service.
#
# - Builder stage installs every dependency (devDeps included so tsc + tsx +
#   typescript are available) and compiles @bizdev/shared, @bizdev/db, and
#   the worker into `dist/` directories. The `fix-esm-imports.mjs` post-build
#   step (T-026Z) runs as part of each workspace's `build` script.
# - Runtime stage copies only the compiled `dist/` outputs + package.json
#   files + a fresh `yarn install --production` so devDependencies (tsx,
#   typescript, ts-node, ...) are stripped. PID 1 is plain
#   `node apps/worker/dist/index.js` — no yarn wrappers eat CPU on the
#   poll loop.
# - The same image is used by `worker`, `worker-telegram`, and `migrate`
#   compose services. `migrate` overrides CMD to run the compiled
#   `packages/db/dist/migrate.js` directly (the npm script that uses tsx
#   only lives in dev and is kept for `yarn verify:db`).

# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:25.2.1-bookworm-slim AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN yarn install --frozen-lockfile

RUN yarn workspace @bizdev/shared build \
  && yarn workspace @bizdev/db build \
  && yarn workspace @bizdev/worker build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:25.2.1-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Root manifest + lockfile so yarn install can reconstruct the workspace.
COPY --from=builder /app/package.json /app/yarn.lock /app/tsconfig.base.json ./

# Workspace package manifests + compiled outputs only — no src/, no scripts/.
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/tsconfig.json ./packages/shared/

COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/tsconfig.json ./packages/db/
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle

COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/tsconfig.json ./apps/worker/

# Production-only install: keeps drizzle-orm, postgres, dotenv, etc.; drops
# tsx, typescript, vitest, and anything else under devDependencies.
RUN yarn install --frozen-lockfile --production && yarn cache clean

USER node

CMD ["node", "apps/worker/dist/index.js"]
