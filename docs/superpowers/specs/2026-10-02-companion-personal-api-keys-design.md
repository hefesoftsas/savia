# Personal API keys for Savia Companion

Status: proposed written design for review; implementation has not started.

## Outcome and approved scope

Allow a signed-in user to create a revocable personal credential for Companion,
connect the native app to preview, and upload private recordings without copying
a browser session token. The user approved personal keys, with recording scopes,
expiry, revocation, one-time secret display, and separate environments. Service
accounts are excluded. Upload, transcription, summaries and recording questions
remain the overall Companion acceptance flow.

This changes shared authentication and therefore needs a reviewed design before
implementation. It does not replace OAuth for interactive sign-in.

## Current behavior and integration points

- `apps/api/src/auth/better-auth.ts` accepts OAuth JWTs or browser sessions.
  A non-JWT Bearer value currently falls through to session authentication.
- `apps/api/src/auth/oauth-resource.ts` grants broad API read/write scopes.
  These remain compatible; new personal keys use an explicit recording policy.
- `apps/api/src/api-shell.ts` installs authentication for protected route groups.
  All groups must recognize and reject unsupported personal-key access.
- `apps/api/src/companion/routes.ts` checks active membership or platform-admin
  access and passes the authenticated owner to private R2 storage.
- Recordings currently contain owner isolation but no tenant metadata.
- `apps/admin/src/features/account/account-page.tsx` provides personal settings.
  This is the entry point for key management, separate from provider credentials.
- Companion already submits Bearer credentials through its constrained native
  HTTP boundary and keeps them in memory. Provider keys are rejected locally.

## Key lifecycle and storage

Create a `personal_api_keys` table in the domain database with an opaque key ID,
principal ID, tenant ID, canonical deployment identifier, name, non-secret display
prefix, secret digest, scope list, creation/expiry/revocation timestamps, and last
successful use. Add forward-only D1/SQLite and PostgreSQL migrations and update
their normal schema/manifest integration. Allocate migration numbers at
implementation time rather than assuming a number remains free.

Generate at least 32 random secret bytes using Web Crypto. Use a distinguishable
`savia_pat_` credential prefix and an opaque identifier. Store a SHA-256 digest of
the high-entropy credential, never its recoverable plaintext. Return the secret
only from creation, with `Cache-Control: no-store`. List and revoke responses,
audit records, errors, logs and telemetry must never contain the secret or digest.

Offer 7-, 30- and 90-day lifetimes, defaulting to 30 days, with a maximum of 90
days and no non-expiring option in this increment. Names are required and bounded
to 80 characters; allow at most 20 unexpired, non-revoked keys per owner. Enforce
the creation limit atomically in the repository, not only in the UI.

Users can list and revoke only their own keys. Revocation is idempotent. Rotation
is an explicit create-new/revoke-old sequence; no hidden overlap or renewal.
Creation and revocation use the existing access audit, recording metadata only.
Last use is best-effort metadata after successful authorization, never a
prerequisite for granting access. Reload reads authoritative metadata from D1.

## Authentication and authorization

Detect the personal-key prefix before JWT/session routing. An invalid, expired,
revoked, wrong-environment or malformed personal key must fail authentication;
it must never fall back to a valid cookie. Unknown Bearer credentials must also
fail closed without silently using a cookie. Preserve supported OAuth tokens.

Resolve the principal and memberships from current database records on every
key request. Reject inactive/deleted users, inactive/deleted tenants, or removed
membership; do not cache positive key authorization across requests. Bind the
key to one eligible tenant selected during creation. Tenant 0 uses the existing
platform-administrator membership rules, without granting platform-wide API
access. A tenant hostname/context that contradicts the key must be rejected.

Attach typed credential context to the actor: authentication kind, key ID, bound
tenant and scopes. A key cannot create/revoke keys, access identity management,
mint OAuth tokens or call unrelated Savia routes. Enforce the allowlist at the
shared authentication boundary, including protected routes outside `/v1`.
Normal owner checks and current membership requirements still apply afterwards.

Key management requires interactive session/OAuth authentication and existing MFA
requirements; a key cannot manage itself or create another credential. Use the
existing CSRF/origin protections for cookie-authenticated mutations. The backend
must validate eligibility and accepted scopes rather than trusting the UI.

Use a canonical backend deployment identifier derived from trusted deployment
configuration, not the request Host header. Store it on every key and require a
match on authentication, so a preview database copied into production does not
activate preview keys. Local environments require their own explicit identifier.

## Scope policy

| Scope | Allowed recording operations |
| --- | --- |
| `recordings:read` | List permitted recordings, download audio, read saved notes. |
| `recordings:upload` | Save native short samples and upload local binary audio. |
| `recordings:process` | Generate transcript/summary and ask about a permitted saved recording; results may incur provider charges. |
| `recordings:delete` | Delete a permitted recording and its notes. |

The capabilities check accepts any valid recording scope and returns the granted
operations so Companion can explain missing upload permission. Default the
Companion preset to `read` and `upload`. Processing and deletion are opt-in.
Unknown scopes, methods and routes are denied. General stateless transcription
and summarization routes are excluded from personal keys in this increment.
Cloud-drive imports are also excluded because they exercise separate connected
account permissions; `upload` does not imply access to Google Drive or OneDrive.

Process authorization permits returning the result of that authorized operation;
it does not grant separate audio downloads. Upload authorization permits returning
metadata of the newly saved recording; it does not grant library listing.

## Tenant boundaries and legacy recordings

Add optional tenant metadata to stored recording objects and returned metadata.
For key-authenticated uploads, derive it exclusively from the credential. For
interactive uploads, derive it from the server-validated active tenant when one
exists. Reject retries attempting to reuse an ID with different tenant metadata,
even if the bytes match. Clients cannot assign arbitrary ownership or tenants.

For key reads, processing and deletion, require both owner and tenant to match
before returning audio/notes or performing writes/provider calls. Apply the same
filter during listing and preserve bounded pagination, including empty filtered
pages with a continuation cursor. Keep existing owner-prefixed R2 object keys;
the metadata is checked by the repository, not only by the UI.

Legacy recordings with no tenant metadata remain accessible to their owner using
the existing interactive library. Personal keys cannot access them. Do not infer
a tenant from the owner's current selection or silently reassign existing audio.
The first increment does not introduce a bulk migration or reassignment UI.
Explain this compatibility boundary in the personal-key guide.

Resolve provider configuration for processing from the key's bound tenant,
explicitly reusing validated tenant configuration. Do not let a browser's active
tenant preference redirect the key's provider credentials or billing context.
Interactive processing retains its existing configuration behavior.

## Personal settings and Companion

Add an API keys section under My account, with name, tenant, scopes, expiry and
last use, plus creation and revocation actions. The creation result displays a
copyable secret once and explains that closing it loses access to the plaintext.
Do not auto-copy credentials or persist them in browser storage. Require a new
key if the original secret is lost. No editing or expanding existing key scopes.

Update Companion's credential label to accept a Savia API key or OAuth access
token, show the selected server, and retain the existing no-redirect behavior.
Keep the credential in memory for this increment; OS keychain integration and
desktop OAuth sign-in are separate work. Never put a key in a URL, log, Vite
variable or checked-in configuration. Permission errors must identify the missing
operation without echoing credentials or upstream response bodies.

## Original recording workflow

The preview web upload of a synthetic 15.3-second WAV passed on 2026-10-02, but
processing failed before a transcript was displayed. Investigate and fix the
proven cause separately from key implementation; a new credential will not fix
provider serialization or configuration. Keep the sample for controlled retest.

Recording question answering remains a separate bounded increment: use the saved
transcript of one authorized recording and the configured summary model, accept
an explicit question and processing consent, and return a grounded answer with
an explicit insufficient-evidence outcome. Require an existing transcript; do not
silently transcribe on question submission. Do not invent timestamps because
current transcripts have no segments. Questions do not create business actions.
The `process` scope protects this route when implemented. Key delivery alone is
not completion of the requested recording/summary/question flow.

## Verification and delivery gates

- Repository and authenticator tests: one-time secret retrieval, hash-only
  persistence, expiry, revocation, owner isolation, inactive identities/tenants,
  removed membership, environment separation and atomic creation limits.
- Route matrix tests: every scope/operation combination, unknown endpoints,
  key-management denial, cloud-import denial, and no cookie fallback on a bad key.
- Tenant tests: cross-tenant read/process/delete denied before accessing payloads
  or calling providers, filtered pagination, legacy-record denial for keys,
  idempotent uploads and correct bound-tenant provider configuration.
- UI and native boundary tests: one-time reveal, reload without secret recovery,
  copy/revoke, capabilities-driven upload access, redirect rejection and no
  credential leakage. Verify existing session/OAuth behavior still works.
- Generate API documentation from route schemas. Update the account/Companion
  guides and preserve existing API reference generation; no handwritten API spec.
- Run targeted API/admin/Companion checks, relevant migration tests and typechecks.
  Native build and real-device capture are distinct checks; report omissions.
- Deploy through the existing preview CI workflow. Validate real key connection,
  native upload, saved playback, summary persistence, question answers, denied
  operations and revocation using synthetic audio. Do not promote to production.

No production enablement, service accounts, wildcard scopes, automatic retention,
new provider accounts, OS permission changes or persistent desktop secret storage
are included.
