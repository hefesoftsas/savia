FROM node:22-alpine AS deps
WORKDIR /srv
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/db-bridge/package.json apps/db-bridge/
COPY packages/crm-shared/package.json packages/crm-shared/
RUN corepack enable && pnpm install --filter @savia/db-bridge... --prod=false

FROM node:22-alpine AS build
WORKDIR /srv
COPY --from=deps /srv/node_modules ./node_modules
COPY --from=deps /srv/apps/db-bridge/node_modules ./apps/db-bridge/node_modules
COPY --from=deps /srv/packages/crm-shared/node_modules ./packages/crm-shared/node_modules
COPY . .
RUN corepack enable && pnpm --filter @savia/db-bridge build

FROM node:22-alpine
WORKDIR /srv/apps/db-bridge
ENV NODE_ENV=production
ENV DB_BRIDGE_HOST=0.0.0.0
COPY --from=build /srv/apps/db-bridge/dist ./dist
COPY --from=build /srv/apps/db-bridge/package.json ./
COPY --from=build /srv/apps/db-bridge/node_modules ./node_modules
COPY --from=build /srv/node_modules /srv/node_modules
EXPOSE 8791
CMD ["node", "dist/index.js"]
