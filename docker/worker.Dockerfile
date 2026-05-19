FROM node:25.2.1-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN yarn install --frozen-lockfile

CMD ["yarn", "workspace", "@bizdev/worker", "start"]
