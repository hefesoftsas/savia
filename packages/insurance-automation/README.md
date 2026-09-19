# Insurance automation

Optional trusted extension contributing four declarative workflow bundles:
customer/policy relations, policy-to-renewal, won-opportunity-to-issuance and
renewal follow-up activities. Definitions live in the sector package; the generic
host prepares additive schemas and inactive workflow drafts.

See [connected operations](../../docs/insurance-operations.md#connected-operations)
for prerequisites, publishing, scheduler requirements and intentional boundaries.

## Operational enhancements

The issuance-to-policy bundle creates real native policy records with a unique source issuance relation. Renewal uniqueness is per policy term (`term_key`), with an advance contact date and a durable follow-up delay. Delayed reminders re-query the renewal and skip closed or deleted cases. Historical policy recovery is explicitly previewed and executed from the Renewals worklist; it never rewrites existing cases and stops if a reviewed source version changed. Existing workflow drafts edited by users remain untouched by template preparation; update those definitions deliberately to adopt new behavior.

Legacy installations retain the unique `source_policy_id` relation. Current templates use the separate nonunique `term_policy_id` relation plus the unique term key, so preparation does not weaken an existing constraint. A legacy case for the same expiration is detected and preserved before creation.
