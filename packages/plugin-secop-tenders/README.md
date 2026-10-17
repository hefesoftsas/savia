# SECOP tenders plugin

An optional Savia tenant plugin for searching live SECOP procurement records and saving selected opportunities to a workspace collection for follow-up. Search history is not persisted. The plugin has Spanish, English, and Portuguese interface copy.

Version 1.7.9 keeps compact contextual actions icon-only with localized
accessible names and tooltips. PDF analysis records remain persisted in the
`procurement_documents` collection but are hidden from the Studio sidebar;
preparation tasks remain available in their native records screen.

The search action expects the signed-in user's configured `secop_live` MCP source in the current tenant and its `buscar_licitaciones` tool. The backend action contract owns request pagination and normalizes the returned records. The plugin accepts common SECOP field aliases and retains source values; absent values remain blank. A source link is shown only when its value parses as an HTTP or HTTPS URL.

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

Version 1.4.0 adds per-tender Documents and Overview tabs, exact portfolio-based
file lookup through `documentos_licitacion`, official download links, and analysis
of user-selected PDFs using the shared host's configured AI. Analysis explicitly
saves an interest and persists the PDF and report in backend storage. See
`docs/secop-tenders-plugin.md` for CAPTCHA handoff, limits, deployment and retries.

The Documents tab downloads and analyzes official PDFs automatically. CAPTCHA/access challenges show an official link, automatic retry, and a manual upload fallback. Files and reports remain in Savia backend storage; browser sessions and credentials are never forwarded. See the [SECOP guide](../../docs/secop-tenders-plugin.md).

Version 1.7.6 adds a plugin-owned **SECOP preparation tasks** collection. From
the native dossier assistant, users can turn a missing requirement into a task
after reviewing its title, responsible person and due date. Tasks can be edited
and completed from the plugin's native records screen. This tracks preparation
work; it does not infer company compliance or add SECOP logic to Savia core.

### Proposal drafts in native chat

The native assistant offers **Generar propuesta DOCX** when the private SECOP
provider advertises document generation. Select the company in the tender's
assistant tab before opening chat; generation uses that authorized profile and
the current tender dossier, without mixing another tender or company. Missing
profile data, prices and unverified statements are left for completion. Review
the source citations, extraction warnings, process deadline and official forms
before signing or presenting the editable draft. The SECOP service creates and
serves the private short-lived download; the plugin does not submit an offer.
