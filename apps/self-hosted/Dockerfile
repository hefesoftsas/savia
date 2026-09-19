FROM node:22.23.2-bookworm-slim AS build
WORKDIR /srv
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY apps/auth/package.json apps/auth/
COPY apps/connector-gateway/package.json apps/connector-gateway/
COPY apps/db-bridge/package.json apps/db-bridge/
COPY apps/legacy-exporter/package.json apps/legacy-exporter/
COPY apps/mcp/package.json apps/mcp/
COPY apps/savia-request/package.json apps/savia-request/
COPY apps/self-hosted/package.json apps/self-hosted/
COPY packages/crm-server/package.json packages/crm-server/
COPY packages/crm-shared/package.json packages/crm-shared/
COPY packages/db/package.json packages/db/
COPY packages/insurance-accounting/package.json packages/insurance-accounting/
COPY packages/insurance-activities/package.json packages/insurance-activities/
COPY packages/insurance-automation/package.json packages/insurance-automation/
COPY packages/insurance-calendar/package.json packages/insurance-calendar/
COPY packages/insurance-campaigns/package.json packages/insurance-campaigns/
COPY packages/insurance-carriers/package.json packages/insurance-carriers/
COPY packages/insurance-claims/package.json packages/insurance-claims/
COPY packages/insurance-collections/package.json packages/insurance-collections/
COPY packages/insurance-commissions/package.json packages/insurance-commissions/
COPY packages/insurance-communications/package.json packages/insurance-communications/
COPY packages/insurance-compliance/package.json packages/insurance-compliance/
COPY packages/insurance-customer-portal/package.json packages/insurance-customer-portal/
COPY packages/insurance-data-quality/package.json packages/insurance-data-quality/
COPY packages/insurance-document-generation/package.json packages/insurance-document-generation/
COPY packages/insurance-documents/package.json packages/insurance-documents/
COPY packages/insurance-endorsements/package.json packages/insurance-endorsements/
COPY packages/insurance-issuance/package.json packages/insurance-issuance/
COPY packages/insurance-opportunities/package.json packages/insurance-opportunities/
COPY packages/insurance-payments/package.json packages/insurance-payments/
COPY packages/insurance-portfolio-dashboard/package.json packages/insurance-portfolio-dashboard/
COPY packages/insurance-quotes/package.json packages/insurance-quotes/
COPY packages/insurance-renewals/package.json packages/insurance-renewals/
COPY packages/insurance-reports/package.json packages/insurance-reports/
COPY packages/insurance-service/package.json packages/insurance-service/
COPY packages/insurance-settlements/package.json packages/insurance-settlements/
COPY packages/insurance-workbench/package.json packages/insurance-workbench/
COPY packages/provider-contracts/package.json packages/provider-contracts/
COPY packages/release-catalog/package.json packages/release-catalog/
COPY packages/tenant-host/package.json packages/tenant-host/
RUN --mount=type=cache,id=savia-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @savia/admin exec vite build
RUN node scripts/prepare-office-runtime.mjs
RUN mkdir -p apps/admin/dist/office/runtime && cp -R .cache/office-runtime/. apps/admin/dist/office/runtime/
RUN --mount=type=cache,id=savia-pnpm,target=/root/.local/share/pnpm/store CI=true pnpm install --prod --offline --frozen-lockfile

FROM node:22.23.2-bookworm-slim
WORKDIR /srv
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
ENV SAVIA_DATA_DIR=/data SAVIA_ADMIN_DIR=/srv/apps/admin/dist
COPY --from=build /srv/package.json /srv/pnpm-workspace.yaml ./
COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/apps ./apps
COPY --from=build /srv/packages ./packages
COPY --from=build /srv/solutions ./solutions
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "--import", "./apps/self-hosted/node_modules/tsx/dist/loader.mjs", "apps/self-hosted/src/index.ts"]
