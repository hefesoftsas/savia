# Insurance quoting

Owner: Savia maintainers. Last reviewed: 2026-09-25.

Step-by-step auto quote flow (`savia.insurance-quoter` + `insurance.quotes`).
Each selected insurer product runs as its own independent flow; products run
concurrently and each provider flow executes its steps sequentially.

## Performance

- Quote startup records elapsed time for setup (`setupMs`), CRM persistence
  (`crmMs`) and each product flow (`duracion_ms` per detail, surfaced as
  `products[productId]`). These diagnostics are not printed in the customer results view.
  Provider durations remain available in persisted details.
- The configured client is resolved with a server-side match query
  (`filters: { logic: "and", conditions: [{ field, op: "eq", value }] }`)
  through the plugin collection API. The full collection scan (up to 2,000
  records) remains only as a compatibility fallback for hosts without filter
  support.
- Quote execution never waits for a full CRM scan before launching product
  flows. After a bounded initial CRM wait, the master record is created; a late
  `cliente` link is saved together with its final summary. A 4s early-client race avoids holding
  providers on slow CRM collections. CRM failures are visible
  ("La cotización continuó sin guardar el cliente en el CRM…") instead of
  silently blocking providers.

## History loading

- Plugin collection requests use the authenticated backend transport, including
  ZIP iframe plugins. A browser outbox acknowledgement is not a committed quote:
  local creates have no server version and previously caused result updates to
  be skipped. Both history reads and writes now use the server source of truth.
- Each successful provider saves its detail and updates the master summary
  without waiting for the remaining providers. One successful offer means
  `Recibida`, even when other products remain pending or fail. Pending products
  retain their own status and do not hide completed offers.
- This change prevents new results from being lost on reload. Earlier detail
  rows that contain no saved response cannot be reconstructed by refreshing
  history; they require an explicit retry.

- Selecting a saved quote performs reads only and never invokes a quote
  action or lookup flow. Retries stay explicit via retry controls.
- History loads only the child details of the selected master with a
  server-side filter (`cotizacion eq quoteId`, or `or` with the historic
  reference name). It pages the filtered result instead of scanning every
  quote's details.
- The UI shows a loading state while details load and an error state on
  failure; an empty result is never presented as a successful load.
- Pending details older than five minutes, or without a usable update/create
  timestamp, are treated as stale failures in history so they can be retried
  instead of remaining "in progress" indefinitely.

## Result snapshots

`cotizaciones_detalle` persists an allowlisted, normalized snapshot per
product so history renders after reload or after recent action runs expire:

- `resultado_snapshot` (Textarea, JSON): `provider`, `productName`,
  `premium`, `quoteNumber`, `monthlyInstallment`, `score`, `badges`,
  `coverages` (9 keys), `highlights`. No raw provider payloads or applicant
  data.
- `duracion_ms` (Number): per-product execution time in ms.

History rendering prefers the snapshot when no matching run is in memory;
absent runs are never treated as empty coverage data. Live sparse responses
keep the honest "No informado por la aseguradora" view.

## Deleting history

- The history view groups retry and delete actions. Delete uses a quiet trash
  action and a separate confirmation with the selected reference and a
  destructive submit button; mobile controls have full-width confirmation actions.
- Deletion removes child details first, then soft-deletes the master with its
  current version. Child deletion failure retains the master for recovery;
  the selection clears immediately with a pending notice. The master is restored
  to the history list on failure, and the server state is refreshed for recovery.
- Supported hosts submit child deletions through the existing versioned bulk API
  in groups of up to 200. A 19-product quote normally uses four requests (list,
  bulk delete, master read, master delete), instead of about 41 sequential requests.
  Version conflicts remain visible and prevent deletion of the master.
- This is optimistic UI backed by online commits, not a durable offline delete
  queue. Reloading during a pending operation reads the actual server state.

## Data model

- `cotizaciones` master + `cotizaciones_detalle` (relation
  `cotizacion → cotizaciones`, no `onDelete:clear`, so children-first delete
  is required). Detail adds optional `resultado_snapshot` + `duracion_ms`.
- Plugin collection `list()` accepts `filters` and `q`, forwarded as
  `?filters=JSON&q=` to `GET /api/records/:object`, which already supports
  `eq/ne/contains/in/…` via `buildWhere`.

## Compatibility and recovery

- The quote plugin declares the master and detail collections for new installations.
  Existing fields and custom layouts are preserved; installation adds missing
  optional fields with a versioned schema update. Before saving optional snapshots
  and durations, the wizard reads the actual detail schema (once per mounted
  collection handle). On older schemas it saves core status, premium, quote number,
  and run reference, and explicitly warns when coverage details cannot be stored.
  Failed writes are surfaced instead of silently leaving history pending.
- Late CRM linking is saved with the terminal master update, avoiding concurrent
  writes using the same version.
- History ignores responses from an earlier selection. Empty saved quotes never
  borrow unrelated recent runs. Saved pending details show a refresh action rather
  than claiming a live provider request is running.
- Deletion reads current child and master versions immediately before removing
  them. Version conflicts remain visible; deletion never retries a conflict without
  the required version. Client-side ownership checks also isolate results returned
  by legacy hosts that ignore collection filters.

- Retrying one or all providers recalculates the master premium from all successful
  offers, so a more expensive retry cannot replace the best price. Summary writes
  are serialized and read the current master version before saving.
- Resuming a quote replaces reselected provider flows instead of duplicating them.
  Starting a new quote or deleting the active quote is blocked while retries run.
- Changing saved quotes resets the insurer filter. A deleted quote's deep link is
  cleared, and deleting one quote cannot clear a newer selection.
