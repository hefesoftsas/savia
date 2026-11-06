# Direct WhatsApp assistant

## Outcome

Meta delivers incoming WhatsApp text messages and delivery receipts directly to
Savia. A tenant explicitly assigns an active virtual employee to its connected
sender. Replies use the existing tenant-owned Nango connection. The pilot uses an
explicit contact allowlist, with no global assistant or sender fallback.

## Boundaries

- A public `/webhooks/whatsapp` endpoint verifies Meta's challenge and authenticates
  raw POST bodies with the app secret before accepting events.
- Resolve the tenant from the registered phone-number ID and WABA ID. Ambiguous
  senders, disabled bindings, inactive memberships and unlisted contacts produce
  no automatic reply. Never trust a tenant ID supplied by a contact.
- Persist accepted events before acknowledging them. Message IDs deduplicate
  retries. D1 stores conversations, processing leases, outbound IDs and delivery
  status. The existing minute scheduler recovers pending work; `waitUntil` may
  start processing immediately.
- Serialize processing per contact. Retry generation failures with a bounded
  attempt count. Fence stale processors. Once outbound sending starts, an uncertain
  result is terminal and requires review; never automatically resend it.
- Reuse the tenant's assistant configuration, assigned employee prompt and
  employee document retrieval. External contacts have no MCP tools, administrative
  identity or action confirmation capability.
- Only text is supported in this iteration. Ignore unsupported media and events
  that do not target an enabled binding. Limit message and batch sizes.
- Tenant administrators can select the employee, enable the binding and manage
  its contact allowlist. Defaults are disabled and an empty allowlist.
- Keep app secret and verification token in backend secrets. Keep deployment
  phone numbers and tenant inventories in private notes, not public source.
- Deploy and verify the endpoint before moving the existing Meta callback from
  Chatwoot. A failed verification preserves the working callback.

## Acceptance

Signed inbound text from an allowed contact produces one tenant-scoped reply,
retains contact history, and records delivery receipts. Forged signatures,
cross-tenant employees, duplicate events and disallowed contacts cannot trigger
generation or sending. Concurrent and stale processors cannot send the same
reply twice. The pilot can be disabled without disconnecting Nango.
