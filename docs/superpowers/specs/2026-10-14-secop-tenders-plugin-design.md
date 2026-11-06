# SECOP tenders plugin

> Historical design: the SECOP integration was retired. See [retirement notes](../../secop-tenders-plugin.md).

The user requested an installable Savia plugin that searches SECOP using the external MCP, saves selected tenders as interests, and tracks them. The selected destination is preview. The plugin is optional and tenant-scoped; procurement is not a platform-core assumption.

## User flow

One plugin screen has Search and My interests. Search submits text and optional entity, department, status and procurement-method filters to `buscar_licitaciones`; results show source facts and pagination. Marking interest saves the selected Socrata row once in `procurement_opportunities`. The remote stable `:id` is unique locally; no search result is automatically imported. Interested records retain a bounded source snapshot and expose status, priority, owner, next follow-up date and notes. Updates use record versions and report conflicts. Data survives reload through Savia's existing collections API; browser storage is not used.

## Host integration

Add a declarative read-only `mcp` plugin action that names a fixed source, fixed tool, record mapping and allowlisted runtime argument names. The API's injected executor resolves only the authenticated principal's source in the current tenant, uses the existing encrypted OAuth service and guarded MCP adapter, and rejects caller-selected destinations/tools or unsupported arguments. The plugin never receives credentials. Existing extension action availability, permissions and run records remain in force; run persistence stores only bounded summaries rather than entire remote datasets. No remote mutation action is introduced.

The SECOP plugin declares source `secop_live`, tool `buscar_licitaciones`, items `/data`, identifier `:id`, and numeric limit/offset pagination. The reviewed source allowlist contains the three known SECOP read tools.

## Delivery and evidence

Build and validate an immutable ZIP, install and activate it only in preview, configure the MCP source in the same tenant and owner, complete OAuth, and verify a live search plus persistence/reload of a selected interest and a versioned tracking update. Respect shared-preview CI delivery protections; use an isolated branch preview for unreleased host changes. Preserve existing repository edits and unrelated operational documents. Credentials remain in private gitignored files and encrypted backend stores. Do not claim preview installation from unit tests or ZIP generation alone.
