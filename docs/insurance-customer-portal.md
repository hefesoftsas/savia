# Authenticated insurance customer portal

`insurance.customer-portal` is an optional authenticated customer workspace. It displays native policies, accepts service requests and claim notices, tracks advisor responses, and uploads/downloads request attachments. It does not create public token links. A claim notice is an intake record, not a coverage decision or replacement for insurer emergency channels.

## Provisioning

1. Install the portal and the policy collection (`polizas`). Ensure `polizas.cliente` contains the exact canonical customer record ID as a scalar string. Policies missing this binding are invisible to customer users. The portfolio package creates the base policy fields; the relationship automation bundle adds `cliente`. Do not match customer names or email strings as security identifiers.
2. Create a separate authenticated account for the customer in the intended workspace. Never reuse an employee/admin account. Use a non-manager membership and remove all unrelated custom grants. Built-in compatibility permissions are additive, not replaced by custom roles: tenant/platform administrators retain broad access. A viewer membership can also inherit tenant-shared connector reads; such extra grants are rejected by this portal. Use an isolated workspace with no inherited shared collections if needed.
3. As an administrator, open **Roles and permissions**, select the exact workspace, and create an enabled custom role for this one customer. Use a unique role name. Add exactly the six grants below. The setup panel in the portal can download a validated JSON blueprint for the supplied customer ID; downloading the file does not provision or assign permissions.
4. In **Members**, assign this role to the customer's principal and remove other custom roles. Check effective permissions for that principal. Confirm the effective grant set matches the blueprint exactly, including field lists and predicates. Do not assign the same role to another customer.
5. Sign in as that customer, open the portal, and verify a second customer's known policy/request IDs are denied by the backend. Test both direct record and attachment access. Only then invite the customer to use it.

## Exact native permission blueprint

Let `CUSTOMER_ID` be the immutable customer ID, not the principal ID. `customer_id = CUSTOMER_ID` below means the native predicate `{ "field": "customer_id", "op": "eq", "value": { "literal": "CUSTOMER_ID" } }`. Use literal equality conditions, not browser filters or a user-editable profile value.

| Resource                               | Action | Record condition                                                                                | Allowed fields                                                                                     |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `collection:polizas`                   | read   | `cliente = CUSTOMER_ID`                                                                         | `name`, `inicio`, `fin`, `prima`, `estado`, `cliente`                                              |
| `page:polizas`                         | read   | All                                                                                             | None                                                                                               |
| `collection:insurance_customer_portal` | read   | `customer_id = CUSTOMER_ID`                                                                     | `name`, `customer_id`, `kind`, `details`, `policy_reference`, `stage`, `response`, `response_date` |
| `collection:insurance_customer_portal` | create | AND: `customer_id = CUSTOMER_ID`; `stage = received`; `response = null`; `response_date = null` | `name`, `customer_id`, `kind`, `details`, `policy_reference`, `stage`, `response`, `response_date` |
| `collection:insurance_customer_portal` | update | `customer_id = CUSTOMER_ID`                                                                     | **None**                                                                                           |
| `page:insurance_customer_portal`       | read   | All                                                                                             | None                                                                                               |

The create grant permits `response` and `response_date` only when both are null. Native record validation materializes empty optional fields as null, so they must be in the create field list; the null predicates prevent forged responses.

The update grant has an empty allowed-field list intentionally. Native attachment upload authorizes against the parent record's update action, while record PATCH still requires permission for every changed field. This enables attachments without allowing customers to rewrite responses, status, customer identity, or submitted details. Native file deletion also uses parent update permission: customers can delete attachments on their own portal records through the native API even though this screen only exposes upload/download.

## Security boundary

The backend ACL evaluates record predicates before pagination/counts, projects allowed fields, rejects forged creates, and checks parent-record permissions for files. The browser never loads all clients and filters them for security. The host exposes only the current authenticated effective policy through `PluginApi.access.effective`; no customer-selected scope or principal is accepted by the portal. Before reading any collections, the portal verifies an exact restricted blueprint and derives its customer ID from that authenticated policy. Missing policy support, extra permissions, differing customers, or incomplete grants fail closed with a setup explanation. Every mutation and file operation rechecks the current policy; the backend remains authoritative if permissions change in between.

Only customer-safe documents belong on these portal records: every attachment is visible to the owning customer. Internal handling notes and sensitive claim investigation material belong in separate staff-only collections. Policy documents are not automatically shared by this package. Native file storage must be configured; standard attachment limits are 5 MB/file and 50 files/record. There is no localStorage/sessionStorage persistence.

## Operations and limits

Customer requests are stored in the portal's dedicated intake collection. Staff use authorized native collection/API tools to update `stage`, `response`, and `response_date`; the client screen never grants those writes. Native service/claims modules remain separate staff workflows. An advisor must triage portal notices into those workflows if required; there is no automatic claim submission to insurers. Only the requested policy ID is captured; it is context, not an authorization grant to that policy.

There is no anonymous access, cross-workspace customer lookup, fiscal action, external message, or external insurer connector. The workspace supports up to 10,000 accessible records through the shared paginated loader. Refresh reloads responses and policy changes. A failed save retains the form for retry, and successful submission clears it only after the server responds.

Register the package manifest, collection requirement, and screens in the release catalog. The host must provide its authenticated access-policy adapter and optional native file adapter. Tests include direct backend denial for another customer's records/files, projected fields, forged status/customer creates, and response-write denial.
