FROM node:22-alpine

WORKDIR /app
ENV YARN_CACHE_FOLDER=/tmp/yarn-cache

RUN mkdir -p /tmp/yarn-cache && chown -R node:node /app /tmp/yarn-cache

USER node

COPY --chown=node:node package.json yarn.lock* ./
RUN yarn install --frozen-lockfile && yarn cache clean

COPY --chown=node:node . .

RUN yarn build

EXPOSE 3000

CMD ["yarn", "start"]
