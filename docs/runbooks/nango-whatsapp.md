# Operations: Nango + WhatsApp messaging per tenant

Owner: platform administrator. Review date: 2026-11-05.

## Scope and ownership

- One WhatsApp connection belongs to one tenant and one user. Savia stores
  the tenant binding, the opaque Nango connection id, and phone metadata
  (`phone_number_id`, `display_phone_number`, `waba_id`) in
  `tenant_whatsapp_connections`. Nango stores the Meta system-user token;
  Savia never receives the token. It is entered directly in Nango's hosted
  Connect form and never appears in Savia responses or logs.
- WhatsApp messaging is independent of CRM connections: a tenant can hold
  both a CRM connection and a WhatsApp connection at the same time.
- Outbound calls go through the Nango proxy allowlist only
  (`apps/api/src/whatsapp/nango.ts`): `GET /v21.0/...` reads and
  `POST /v21.0/<phone_number_id>/messages` sends. Any other provider path
  is rejected with `WHATSAPP_UNAVAILABLE`.
- Inbound WhatsApp webhooks are out of scope for this iteration: Nango does
  not forward Meta webhooks, so delivery receipts and replies arrive only
  when a Meta webhook subscription is configured.

## Nango preparation (browser handoff)

Create the `whatsapp-business` integration in the intended Nango environment
and obtain a Meta system-user token with WhatsApp management and messaging
permissions for the business portfolio that owns the sender. Keep account
identifiers and rollout inventories in private deployment notes.
Select **API Key** auth: there are no credentials
to configure at integration level. Enter the Meta token in the **API Key**
field when creating each connection through Nango Connect. See the
[Nango WhatsApp Business setup guide](https://nango.dev/docs/api-integrations/whatsapp-business).
Then set the backend variables without adding
them to the repository, `wrangler.jsonc`, or `VITE_*` settings:

```text
NANGO_BASE_URL=https://<host-api-nango>
NANGO_CONNECT_URL=https://<host-connect-nango>
NANGO_WHATSAPP_INTEGRATION_ID=whatsapp-business
NANGO_API_KEY=<server-side-nango-secret>
```

Use `wrangler secret put NANGO_API_KEY` for the server key. Production and
preview render `NANGO_WHATSAPP_INTEGRATION_ID=whatsapp-business` by default;
self-hosted reads it from `infra/secrets` via `infra/self-hosted/env.example`.

The current renderer uses `https://nango.cloud.hefesoft.com` for the API and
`https://nango-connect.cloud.hefesoft.com` for Connect. The server API key
selects the Nango environment; verify that it belongs to the environment
containing the integration. Creating the integration in the dashboard does
not deploy the WhatsApp code or update an existing Worker's configuration.

Dashboard test connections are for diagnostics. Create actual tenant
connections through Savia so Nango records the expected end-user identity.

The `NANGO_API_KEY` stays a Worker secret and needs these environment scopes:

| Scope                                | Operation                                          |
| ------------------------------------ | -------------------------------------------------- |
| `environment:connect_sessions:write` | Create Connect and reconnect sessions              |
| `environment:connections:read`       | Verify connection ownership and tenant tags        |
| `environment:connections:delete`     | Disconnect the tenant's connection                 |
| `environment:proxy`                  | Validate the sender and send messages through Meta |

See the [Nango API key scopes reference](https://nango.dev/docs/reference/backend/http-api/api-keys).
Savia does not read Meta credentials directly, so WhatsApp does not require
`environment:connections:read_credentials`. A shared key used by other Savia
integrations may need additional scopes. Local development forwards every
`NANGO_*` variable automatically.

## Tenant connection flow

Every mutation requires an explicit `agencyId` naming the selected tenant.
Membership alone never selects a tenant implicitly, and a platform role does
not make the first active tenant a default. Keep each tenant's connection
separate; sharing a test phone does not mean sharing a Nango connection id.

1. A user with an active tenant membership opens
   `#/my-integrations?tab=whatsapp` (WhatsApp row, brand logo).
2. **Conectar** creates a short-lived Nango Connect session for that tenant.
   The browser receives only the session token and the public Nango URLs.
3. The user authorizes the `whatsapp-business` integration in Nango with the
   Meta system-user token prepared by the platform administrator.
4. Nango returns an opaque connection id. After completion, the user fills
   the phone number id, visible number, and WABA id in the **Número de
   WhatsApp** panel. The completion API can also accept this metadata when
   it is already available.
5. Savia verifies the Nango connection belongs to `user:<principal-id>` and
   its `agency_id` tag matches the explicitly selected tenant. Missing or
   mismatched tenant tags are rejected; dashboard diagnostic connections
   cannot substitute for tenant Connect sessions. Savia then validates the
   phone number live against the WhatsApp Cloud API through
   the proxy, and persists only safe metadata with status `connected`.
6. **Probar envío** sends a short free-form text through
   `POST /v21.0/<phone_number_id>/messages`. Delivery outside an open
   24-hour customer-service window requires a pre-approved template, which
   this endpoint does not send; the API then reports `WHATSAPP_SEND_FAILED`.

**Reconectar** uses Nango's reconnect session endpoint with the existing
connection and integration IDs, preserving the tenant binding. Authentication
failures during sender validation mark that existing connection as requiring
reconnection. Invalid phone IDs, temporary upstream errors, and rejected
replacement connections do not invalidate an existing healthy connection.

## Verification after deployment

1. With `NANGO_WHATSAPP_INTEGRATION_ID` unset, confirm the WhatsApp tab shows
   **No disponible** and `POST /v1/whatsapp/connections/connect-session`
   returns `503`.
2. Sign in as a tenant administrator, connect, link the number, and send a
   test message to a contact with an open window. Confirm the row shows
   **Conectado** with the visible number and no secret in the UI.
3. Repeat the list query with another tenant and confirm `403`; confirm a
   second tenant cannot reuse the first tenant's Nango connection (`409`).
4. Disconnect and confirm a later send returns `404`.

## Safe diagnostics

- `WHATSAPP_UNAVAILABLE`: check the four Nango variables without printing
  their values.
- `WHATSAPP_RECONNECT_REQUIRED` / `409`: the Meta token was rejected or
  revoked. Ask the tenant administrator to use **Reconectar**; never paste a
  token manually to repair the link.
- `WHATSAPP_SEND_FAILED` / `NANGO_REQUEST_FAILED`: check Nango status,
  DNS/TLS, and the redacted Nango logs. Never copy provider response bodies
  into logs or user feedback.
- `WHATSAPP_NUMBER_NOT_LINKED` / `422`: link the phone number first.
