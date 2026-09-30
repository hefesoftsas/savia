# Account email implementation plan

**Goal:** Complete password recovery and email ownership verification using Better Auth, with an explicit administrator override and tenant-owned SMTP settings.

**Architecture:** Better Auth owns verification and reset tokens. The auth service stores encrypted tenant SMTP settings and routes account email by the user's server-assigned tenant. The API authorizes configuration changes; the admin UI never receives stored passwords. Existing session and MFA rules remain enforced.

**Requirements:** Preserve existing edits, tenant isolation and the incumbent UI. Default new users to unverified; preserve bootstrap access. Use Mailpit for local delivery. Reset tokens expire after 15 minutes and revoke sessions. Never expose account existence in public recovery responses.

- [x] Extend Better Auth callbacks, provisioning and protected administrator override; test verification, reset and token replay.
- [x] Add accessible recovery and verification screens preserving Savia branding.
- [x] Add encrypted tenant SMTP storage, authenticated administration endpoints, transport security and a tenant settings panel.
- [x] Expose verification state and explicit override in user administration; regenerate API types.
- [x] Wire SMTP into local and self-hosted runtimes, add Mailpit, and document operation.
- [x] Verify focused tests, types, real SMTP flows and combined diff.

**Verification:** Actual Mailpit delivery passed from the local Cloudflare Worker and the self-hosted runtime. The disposable end-to-end check covers verification, password reset, token replay rejection, generic recovery responses and session revocation. Auth, API and admin focused tests and TypeScript checks passed; admin assets build successfully. Browser visual QA could not run: the integrated browser rejected both local preview URLs with `ERR_BLOCKED_BY_CLIENT`. Static Impeccable checks and component tests cover the interface, but do not replace desktop/mobile screenshot inspection.

**Review focus:** Cross-tenant configuration access; unverified sign-in; forged or reused links; missing SMTP or delivery failures during provisioning; existing accounts and bootstrap migrations. No deployment is part of this task.
