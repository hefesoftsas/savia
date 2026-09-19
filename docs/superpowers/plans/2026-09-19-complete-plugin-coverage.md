# Complete optional plugin coverage

Owner: Savia maintainers. Last reviewed: 2026-09-19.

The user approved the twelve proposed plugins and all six existing-plugin
expansions. Preserve Savia's generic core, existing permissions and backend-only
persistence. Extend the established operational visual system.

## Delivery groups

1. Financial packages: payments and bank import/allocation, producer settlements,
   balanced accounting exports. Monetary changes use one versioned aggregate;
   never imply atomic updates across independent CRM records.
2. Integration packages: communications, carrier operations, calendar and
   campaigns. Provider configuration is explicit; absent configuration blocks
   external actions. Stable operation keys, accepted-versus-delivered states,
   secrets on the backend and bounded gateway responses are required.
3. Existing operations: recurring policy terms, advance renewal follow-up,
   controlled historical processing, service escalation, native policy creation,
   document validity and attachments. Repeated execution must not duplicate work.
4. Additional packages: document generation/signature requests, data quality and
   import, management reporting, compliance dossiers, customer portal and a
   combined customer view. Reuse authorized native collections and files.
5. Integration: catalog registration, dependencies, release descriptors, guides,
   API/schema contracts and optional-extension isolation.

## Shared contracts

Each independent package exports `manifest`, `requirement`, and `screens` through
its existing package subpath convention. Runtime settings/connectors additionally
export `extension`. Catalog composition alone imports sector packages.
`PluginApi` remains the authorized client boundary. Extend it with optional file
operations routed through the existing record-file API. Older test mocks may omit
this optional capability; the UI explains that the host needs updating.

## Review focus and verification

- Financial duplicate imports, over-allocation, decimal precision and CSV formula
  escaping: domain tests plus version-conflict UI tests.
- Provider retries, unknown outcome, credential leakage and unsupported providers:
  adapter contract tests; no live external writes during verification.
- Tenant/customer isolation and field access: backend authorization tests, never
  browser filtering as authorization.
- Renewal term keys, repeat backfill, invalid coverage and document expiry:
  deterministic domain tests plus native workflow integration tests.
- Files and imported/generated text: bounded sizes, escaped content, denied access,
  malformed input and stale record versions.
- Run focused checks while implementing; finish with repository tests, typecheck,
  production build, packaging, scoped independent review and a batched desktop/
  mobile browser inspection.

## Execution

Use independent agents for groups 1–3 with disjoint package ownership. Main agent
owns shared contracts, group 4 and catalog integration. Preserve existing changes;
no deployment or live customer messages are part of local verification.
