FROM node:25.2.1-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN yarn install --frozen-lockfile

# T-026Z: pre-compile the workspace packages and the worker so the prod
# container runs plain `node dist/index.js`. The previous CMD launched the
# worker through tsx (`node --import tsx src/index.ts`), a development-only
# TypeScript loader that transpiles every imported .ts file on the hot
# path. On the macOS Docker VM this ran at ~50% CPU on idle. With the
# packages compiled and the worker running compiled JS, idle CPU drops to
# single-digit percent.
RUN yarn workspace @bizdev/shared build \
  && yarn workspace @bizdev/db build \
  && yarn workspace @bizdev/worker build

CMD ["yarn", "workspace", "@bizdev/worker", "start"]
