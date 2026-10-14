# SECOP tenders plugin

An optional Savia tenant plugin for searching live SECOP procurement records and saving selected opportunities to a workspace collection for follow-up. Search history is not persisted. The plugin has Spanish, English, and Portuguese interface copy.

The search action expects the tenant's configured `secop_live` MCP source and its `buscar_licitaciones` tool. The backend action contract owns request pagination and normalizes the returned records. The plugin accepts common SECOP field aliases and retains source values; absent values remain blank. A source link is shown only when its value parses as an HTTP or HTTPS URL.

## Local development

From the repository root, install workspace dependencies and run:

```sh
pnpm --filter @savia/plugin-secop-tenders test
pnpm --filter @savia/plugin-secop-tenders typecheck
pnpm plugin:dev packages/plugin-secop-tenders --tenant 0
```

The local plugin watcher builds the package and installs a development version in the selected tenant. Search needs the declared backend action to be configured. Collection records persist through the Savia host API and use versioned updates; duplicate source IDs return the existing saved record without overwriting its tracking fields.

To create the immutable tenant ZIP after verifying the package:

```sh
pnpm store:pack packages/plugin-secop-tenders
```
