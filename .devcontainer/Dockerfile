FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends curl lsof ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.24.0

WORKDIR /workspace
# Seed writable directories for Docker named volumes before the source bind mount.
RUN mkdir -p \
    /workspace/node_modules \
    /workspace/apps/admin/node_modules \
    /workspace/apps/api/node_modules \
    /workspace/apps/auth/node_modules \
    /workspace/apps/connector-gateway/node_modules \
    /workspace/apps/db-bridge/node_modules \
    /workspace/apps/legacy-exporter/node_modules \
    /workspace/apps/mcp/node_modules \
    /workspace/apps/savia-request/node_modules \
    /workspace/packages/crm-server/node_modules \
    /workspace/packages/crm-shared/node_modules \
    /workspace/packages/db/node_modules \
    /workspace/packages/insurance-portfolio-dashboard/node_modules \
    /workspace/packages/insurance-quotes/node_modules \
    /workspace/packages/provider-contracts/node_modules \
    /workspace/packages/release-catalog/node_modules \
    /workspace/packages/tenant-host/node_modules \
    /workspace/apps/api/.wrangler \
    /workspace/apps/auth/.wrangler \
    /workspace/apps/savia-request/.wrangler \
    /home/node/.local/share/pnpm/store \
    && chown -R node:node /workspace /home/node/.local
USER node
CMD ["sh", ".devcontainer/start.sh"]
