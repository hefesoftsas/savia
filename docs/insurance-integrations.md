# Optional insurance integrations

`insurance.communications`, `insurance.carriers`, `insurance.calendar`, and
`insurance.campaigns` are separately installed optional extensions. None includes
an insurer, mail, messaging, or calendar account. They do not send anything until
an administrator configures an encrypted connection and a user explicitly executes
an operation. Core Savia remains industry independent.

## Deployment and connections

Each package exports `manifest`, trusted `extension`, `requirement`, `screens`, and
`createConnectorActions(options)`. Pass a deployment-controlled `allowedOrigins`
array when creating connector actions. The empty default rejects all destinations.
The origin must be an operator-owned HTTPS integration endpoint. Do not allow
customer-controlled DNS, private-network routing, or broad wildcard origins;
network egress controls must prevent DNS rebinding to private infrastructure.

Create a connection using the existing extension connections API with connector
ID `insurance.<package>.gateway`, `endpoint`, and `token`. The runtime encrypts the
`token` as a declared secret. Browsers receive only connection summaries. Tokens
are never placed in application settings, records, or browser storage. Connection
management requires the host's existing administrative permission.

## Adapter interoperability contract

This is an implementation contract for an operator-owned adapter, not a claim
that an insurer implements it. The executor sends POST to the exact configured
endpoint, prohibits redirects, sets a 20-second deadline, and accepts at most
64 KiB of response data. The JSON envelope contains `version: 1`, `extensionId`,
`actionId`, `tenantId`, `principalId`, and `payload`. Authentication uses a bearer
token. `Idempotency-Key` combines tenant, extension, and the persisted operation
key. The adapter **must durably deduplicate that key before any external side
effect**, reject changed payloads under a reused key, and return the original
receipt for retries. It must support querying an uncertain operation by its key.
A timeout or malformed response is an unknown outcome, never delivery success.

The adapter must authorize the tenant and principal, validate the operation,
resolve provider credentials server-side, and recheck current authoritative
consent and suppression immediately before every communication. Client-supplied
consent flags are an explicit operator acknowledgement, **not authorization or
proof of consent**. Campaign payloads include `source` and `clientId` so the adapter
can consult the authoritative customer record. Do not enable campaign execution
against an adapter that cannot perform that check. Apply provider rate limits,
unsubscribe rules, and recipient validation in that adapter.

Receipts contain a nonempty `reference` and `state`: `accepted`, `pending`,
`delivered`, or `failed`. Optional `signedAt` (ISO timestamp with offset) and HTTPS `evidenceUrl` can carry signature evidence; a delivered receipt alone never proves a signature. An optional HTTPS `documentUrl` is allowed for carrier
documents. Additional provider fields are discarded; arbitrary provider error
bodies are never returned. `accepted` means queued by the provider, not delivered,
and an accepted issuance request does not mean a policy has been issued.

Operations:

- Communications: `send` with recipient, rendered body and consent acknowledgement;
  `status` with the original operation key. Templates support `{{nombre}}`.
  Saved drafts persist title, JSON payload, and stage in `insurance_communications`.
- Carriers: `policy-status`, `documents`, `request-issuance` with carrier and policy
  or request reference. The adapter must implement the selected operation.
- Calendar: `sync` with event ID, title, start/end instants, description and IANA
  display timezone. UTC ICS export works without an external connection. Explicit
  offsets are required to avoid ambiguous daylight-saving local times. ICS text is
  escaped and lines are folded by UTF-8 byte length.
- Campaigns: `send` per eligible customer through the communication-capable adapter.
  A user selects a backend-authorized collection and an optional exact `segment`.
  Records require `marketing_consent: true`, `marketing_suppressed: false`, and a
  valid `email`; absent consent/suppression is excluded. `name` or `nombre` supplies
  personalization. Preview deduplicates email addresses and execution reloads the
  source before sending. All pages must load successfully; a failed or oversized
  source never silently executes a partial audience. Preparation saves campaign
  definition and operation key, not a live external action.

Action runs provide the backend history. A run that succeeded only confirms the
adapter returned a valid receipt; the receipt state carries delivery meaning.
Unknown outcomes require status reconciliation before retrying with the same key.
No connector is called during automated tests; provider responses are mocked.

Calendar synchronization requires a saved, unchanged event revision. Retry keys include
the event ID and backend version, so retries of that revision deduplicate while an
edited and saved revision can synchronize independently. Existing communication drafts
and events retain optimistic record versions; stale saves fail instead of overwriting.
