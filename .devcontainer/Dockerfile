# syntax=docker/dockerfile:1
FROM node:22-bookworm

RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi \
    && apt-get update && apt-get install -y --no-install-recommends curl lsof ca-certificates git procps python3 make g++ zip unzip \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.24.0

WORKDIR /workspace
# Seed writable directories for Docker named volumes before the source bind mount.
RUN mkdir -p \
    /workspace/node_modules \
    /workspace/apps/admin/node_modules \
    /workspace/apps/api/node_modules \
    /workspace/apps/auth/node_modules \
    /workspace/apps/companion/node_modules \
    /workspace/apps/connector-gateway/node_modules \
    /workspace/apps/db-bridge/node_modules \
    /workspace/apps/legacy-exporter/node_modules \
    /workspace/apps/mcp/node_modules \
    /workspace/apps/plugin-registry/node_modules \
    /workspace/apps/savia-request/node_modules \
    /workspace/apps/self-hosted/node_modules \
    /workspace/packages/db/node_modules \
    /workspace/packages/insurance-accounting/node_modules \
    /workspace/packages/insurance-activities/node_modules \
    /workspace/packages/insurance-automation/node_modules \
    /workspace/packages/insurance-calendar/node_modules \
    /workspace/packages/insurance-campaigns/node_modules \
    /workspace/packages/insurance-carriers/node_modules \
    /workspace/packages/insurance-claims/node_modules \
    /workspace/packages/insurance-collections/node_modules \
    /workspace/packages/insurance-commissions/node_modules \
    /workspace/packages/insurance-communications/node_modules \
    /workspace/packages/insurance-compliance/node_modules \
    /workspace/packages/insurance-customer-portal/node_modules \
    /workspace/packages/insurance-data-quality/node_modules \
    /workspace/packages/insurance-document-generation/node_modules \
    /workspace/packages/insurance-documents/node_modules \
    /workspace/packages/insurance-endorsements/node_modules \
    /workspace/packages/insurance-issuance/node_modules \
    /workspace/packages/insurance-opportunities/node_modules \
    /workspace/packages/insurance-payments/node_modules \
    /workspace/packages/insurance-portfolio-dashboard/node_modules \
    /workspace/packages/insurance-quotes/node_modules \
    /workspace/packages/insurance-renewals/node_modules \
    /workspace/packages/insurance-reports/node_modules \
    /workspace/packages/insurance-service/node_modules \
    /workspace/packages/insurance-settlements/node_modules \
    /workspace/packages/insurance-workbench/node_modules \
    /workspace/packages/plugin-example-tasks/node_modules \
    /workspace/packages/plugin-sdk/node_modules \
    /workspace/packages/plugin-ui/node_modules \
    /workspace/packages/provider-contracts/node_modules \
    /workspace/packages/release-catalog/node_modules \
    /workspace/packages/studio-server/node_modules \
    /workspace/packages/studio-shared/node_modules \
    /workspace/packages/tenant-host/node_modules \
    /workspace/apps/api/.wrangler \
    /workspace/apps/auth/.wrangler \
    /workspace/apps/savia-request/.wrangler \
    /home/node/.local/share/pnpm/store \
    && chown -R node:node /workspace /home/node/.local
USER node
CMD ["sh", ".devcontainer/start.sh"]
