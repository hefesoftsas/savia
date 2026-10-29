# Complete SECOP filter catalogs

> Historical design: the SECOP integration was retired. See [retirement notes](../../secop-tenders-plugin.md).

**Goal:** Load department, entity and modality options from the complete SECOP dataset, independently of tender search criteria and loaded result pages.

**Design:** Add a read-only `opciones_licitaciones` tool to the existing SECOP provider. It aggregates distinct allowlisted columns and returns a verified complete catalog, cached on the backend for six hours. Three fixed plugin actions request one catalog each through the existing OAuth source. The UI loads them independently on entry, reports loading/failure per catalog and permits retry. Autocomplete matches against all values and progressively renders options for browsing; it does not truncate the searchable catalog.

**Delivery:** Keep provider OAuth settings, bindings and secrets intact, back up the existing Worker source/settings before an additive deployment, warm and verify all catalogs, then update the optional plugin in shared preview workspace 12. Tender search and tracking permissions remain unchanged.

**Checks:** Provider allowlisted query generation, complete response and cache validation, cache coalescing, malformed/truncated results; plugin fixed action calls and catalog validation; autocomplete access to options after the first visible batch, keyboard and scrolling behavior; plugin typecheck, packaging and live Chrome checks before any tender search.

## Evidence and refinement

- Real full-dataset aggregation returned 34 department values, 17 modality values
  and 11,881 entity values. The complete entity MCP response is about 539 KB.
- Cold catalog MCP calls took 13–21 seconds, exceeding the host's 15-second
  budget in some cases. A dedicated backend KV namespace therefore stores public
  complete snapshots. Fresh snapshots return immediately; after six hours the
  provider serves the last valid complete snapshot while refreshing in the
  background through `waitUntil`. Failed refreshes never replace valid data.
- Provider code and configuration were backed up privately. Existing OAuth and
  Socrata secret bindings were verified unchanged; `CATALOG_KV` was added without
  broadening OAuth scopes. All three verified complete snapshots were seeded.
- Client requests remain fixed per catalog and do not accept tender criteria.
- 58 package tests and package TypeScript checks pass before preview delivery.
- Warm authenticated MCP reads completed in 453 ms (departments), 392 ms
  (modalities) and 735 ms (entities).
- Plugin 1.3.0 was uploaded and activated in shared preview workspace 12.
- Chrome showed 11,881 entities, 17 modalities and 34 department options before
  any tender search. The department and modality dropdowns exposed all 34/17
  options. Searching the entity catalog found and selected its last value,
  `XM COMPAÑIA DE EXPERTOS EN MERCADOS SA ESP`, without loading tender results.
