# SECOP tenders plugin

An optional Savia tenant plugin for searching live SECOP procurement records and saving selected opportunities to a workspace collection for follow-up. Search history is not persisted. The plugin has Spanish, English, and Portuguese interface copy.

The search action expects the tenant's configured `secop_live` MCP source and its `buscar_licitaciones` tool. The backend action contract owns request pagination and normalizes the returned records. The plugin accepts common SECOP field aliases and retains source values; absent values remain blank. A source link is shown only when its value parses as an HTTP or HTTPS URL.

Saved interests are monitored hourly through the creator's own `secop_live`
connection. The plugin package declares the fixed read-only detail action and
field mapping; the host owns scheduling and in-app notifications. Users can
pause monitoring per interest, and awarded/discarded interests pause
automatically. See [the user guide](../../docs/secop-tenders-plugin.md) for
reminder behavior and connection recovery.

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

Plugin 1.3.0 additionally requires the read-only `opciones_licitaciones` tool
from `provider/catalogs.mjs`. Department, entity and modality options load from
complete catalogs independently of tender results. See the installation and
provider deployment notes in `docs/secop-tenders-plugin.md`.
