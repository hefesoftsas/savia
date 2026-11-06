# AI plugin IDE

Users create editable plugin code in Savia with its configured AI, preview it,
iterate, and publish a release into the current workspace's existing store.
The user authorized implementation and iteration through completion.

## Architecture

Extend My plugins with a lazy-loaded IDE. Preserve Savia's existing visual tokens,
Monaco CDN loading, authenticated API client and tenant store upload permissions.
Use a dedicated, tool-free structured AI generation endpoint with explicit tenant
authorization and server-side provider configuration. Never send provider keys to
the editor or grant generated code the assistant's tools.

The workspace edits entry.tsx, savia-extension.json, store.json and preview.json.
React and createRoot are available without imports. Sucrase strips TypeScript and
compiles JSX; a production React runtime is bundled into the published ESM.
Arbitrary npm imports and server processes are outside this initial authoring
contract. Save drafts per principal and workspace with CAS updates, scoped browser
recovery, and portable export/import. AI produces proposed file
replacements; applying is explicit and can be undone.

Preview the exact compiled module in an opaque iframe, without network or live
workspace access. Supply editable fixture collections and settings, report runtime
errors, and discard mock changes on restart. Compilation, invalid metadata and
preview errors block publication until corrected and previewed again.

Publish a validated ZIP through the existing tenant upload endpoint. Immutable
version conflicts and quotas remain backend-enforced; installation stays separate.
Distinguish workspace store publication from the shared upstream registry, whose
publication requires a separately configured publisher token. Retain release sources
for re-editing and retrieve authorized collection metadata for AI context.
This execution environment has no deployment
credentials, so remote deployment cannot be claimed.

## Alternatives considered

Sandpack (Apache-2.0) provides embedded editing and bundling, but introduces a
second runtime/service boundary. WebContainers provide a broader Node environment
with additional runtime and hosting requirements. Existing Monaco + Sucrase +
Savia sandbox best matches the self-contained store artifact contract. Package
metadata checked against npm on 2026-10-04; no third-party runtime installed.

## Verification

Test tenant authorization and invalid generated output, compilation and ZIP
compatibility, preview isolation, proposal application/undo, stale preview guards,
store errors and successful publication. Run relevant existing store/editor tests,
type checks and the admin production build. Do not claim live AI or remote
publication without credentials and observed responses.
