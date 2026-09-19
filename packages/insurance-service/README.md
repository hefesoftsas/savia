# @savia/insurance-service

Optional independently installed insurance operations plugin.

See [the operations guide](../../docs/insurance-operations.md) for supported
workflows, validation boundaries and source release packaging.

Run `pnpm --filter @savia/insurance-service test` and
`pnpm extension:pack insurance-service`.

## Response and escalation

A case can record an escalation date and responsible person. The saved-record escalation action is available for open, due commitments and transfers ownership using a version-checked update; closed requests cannot escalate. Response/escalation dates cannot precede receipt. The response action creates a communications draft from the saved outcome and an explicit recipient. Consent defaults to unverified; review and actual dispatch happen in Communications. Creating a draft does not resolve the request or assert delivery.
