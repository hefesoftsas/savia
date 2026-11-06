# @savia/insurance-issuance

Optional independently installed insurance operations plugin.

See [the operations guide](../../docs/insurance-operations.md) for supported
workflows, validation boundaries and source release packaging.

Run `pnpm --filter @savia/insurance-issuance test` and
`pnpm extension:pack insurance-issuance`.

## Native policy and delivery

Prepare and publish the **Emisión → póliza** automation to create a native `polizas` record when issuance becomes `issued`. Native policy creation is idempotent through the unique source issuance relation; existing policies are never overwritten. The delivery action creates a Communications draft with an explicit recipient and unverified consent. Complete consent and dispatch there; draft creation does not mark the issuance delivered or claim carrier/provider acceptance.
