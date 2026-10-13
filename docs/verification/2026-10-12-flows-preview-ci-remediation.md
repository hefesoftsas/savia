# Flows preview CI remediation

PR: [294](https://github.com/hefesoftsas/savia/pull/294). This follow-up addresses
the CI failures discovered before the authorized merge and preview deployment.
Flows provisioning and execution remain disabled.

## Build and dependency fixes

Compose and the devcontainer now isolate dependency directories for every Flows
workspace. The contract derives its expected set from `pnpm-workspace.yaml`,
including nested workspaces. Auth pins `jose` to 6.2.11 so its direct Better Auth
core, OAuth-provider, and SSO packages share the same peer context. No Auth
runtime logic or type-checking rules were disabled. Auth's typecheck and 212
tests passed after the dependency change.

## Security triage

The CodeQL findings that required code changes were addressed with own-property
JSON writes, complete snippet delimiter removal, POSIX shell argument quoting,
escaped SVG attributes, bounded linear text parsing, encoded Discord URLs, and
explicit trusted-origin validation with redirects rejected in FFmpeg downloads.
Runtime node adaptations retain MIT attribution and are recorded by digest in
`UPSTREAM.json`. FFmpeg was not started or provisioned.

Four CodeQL alerts were dismissed as false positives with recorded reasons:

- Alerts 63, 64, and 65 concern SHA-256 lookup of 256-bit randomly generated
  bearer tokens. These are not user-chosen passwords; creation and rotation use
  `crypto.randomBytes(32)`. The cryptography was preserved.
- Alert 21 concerns an incomplete OAuth-pair error that prints static
  configuration key names. `oauthCredentialPairs` contains names, not values;
  captured Wrangler errors are replaced by static messages.

Six Gitleaks findings were confirmed as literal `YOUR_API_KEY`/`YOUR_SECRET`
placeholders, a synthetic form-token test key, and a `ProviderConfig` TypeScript
annotation misidentified as a LinkedIn client ID. The four allowlists constrain
both exact values and file paths. The complete reachable-history scan passed
with zero findings; no scanning rule or directory was excluded.

Regression coverage includes prototype keys arriving after an empty object,
malformed snippet markup, shell substitutions, SVG attribute injection, long
whitespace/escaped-string inputs, forged Discord OAuth parameters, untrusted
media origins, credentials in URLs, and redirect rejection. The Discord cases
failed on the original URL interpolation and passed after encoding.

The local focused checks passed. The full relevant checks and the new GitHub CI
run must pass before merging. Preview deployment is followed through the
centralized pipeline; no Flows activation is part of this change.
