# Insurance quoting

Owner: Savia maintainers. Last reviewed: 2026-09-25.

Step-by-step auto quote flow (`savia.insurance-quoter` + `insurance.quotes`).
Each selected insurer product runs as its own independent flow; products run
concurrently and each provider flow executes its steps sequentially.

## Performance

- Quote startup records elapsed time for setup (`setupMs`), CRM persistence
  (`crmMs`) and each product flow (`duracion_ms` per detail, surfaced as
  `products[productId]`). The UI shows preparation vs CRM vs per-provider time;
  it does not change which products run or how they are isolated.
- The configured client is resolved with a server-side match query
  (`filters: { logic: "and", conditions: [{ field, op: "eq", value }] }`)
  through the plugin collection API. The full collection scan (up to 2,000
  records) remains only as a compatibility fallback for hosts without filter
  support.
- Quote execution never waits for a full CRM scan before launching product
  flows. The master record is created immediately; the `cliente` link is
  patched when the CRM responds. A 4s early-client race avoids holding
  providers on slow CRM collections. CRM failures are visible
  ("La cotización continuó sin guardar el cliente en el CRM…") instead of
  silently blocking providers.

## History loading

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

- The history view offers delete with a confirmation step.
- Deletion removes child details first, then soft-deletes the master with its
  current version. Child deletion failure retains the master for recovery;
  the history list refreshes and the selection clears only after success.

## Data model

- `cotizaciones` master + `cotizaciones_detalle` (relation
  `cotizacion → cotizaciones`, no `onDelete:clear`, so children-first delete
  is required). Detail adds optional `resultado_snapshot` + `duracion_ms`.
- Plugin collection `list()` accepts `filters` and `q`, forwarded as
  `?filters=JSON&q=` to `GET /api/records/:object`, which already supports
  `eq/ne/contains/in/…` via `buildWhere`.
