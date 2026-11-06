# Insurance quote history and performance design

## Goal

Make the step-by-step insurance quote flow feel responsive, reliably reopen saved quotes with their original result details, and let users delete quotes from history. Keep the current execution model: each selected insurer product runs as its own independent flow.

## Current behavior

- Submitting a quote persists or updates the applicant in the configured client collection before creating the quote master record. The client lookup reads up to 2,000 records, so quote startup can wait on unrelated CRM data.
- The quote master is created before product flows start. A child detail is created per selected product, then all product flows are dispatched concurrently. The UI awaits all of them, so the final completion time follows the slowest product flow.
- Each provider flow executes its steps sequentially. Individual outbound requests have a 30 second timeout; one slow provider can therefore keep the batch in progress after other products have returned.
- Selecting a history entry reads detail records and maps them into display state; this handler does not execute insurer flows. However, it currently reads all pages of all quote details and filters them in the browser.
- Detail rows persist identifiers, status, premium, quote number, and error, but not enough normalized response data to reproduce all offer details independently of recent in-memory action runs.
- The quote master and its child details use soft deletion. The server prevents deleting a master while child details reference it, so deletion must remove children first and only remove the master after those removals succeed.

## Proposed behavior

### Performance visibility and improvements

- Record elapsed time for quote setup and for each independent product flow. Show or retain enough timing information to distinguish local preparation, CRM persistence, and provider execution; do not change which products run or how they are isolated.
- Avoid blocking quote execution on a full CRM scan. Resolve the configured client by a server-side match query when supported. If the match cannot be resolved promptly, preserve quote execution and treat CRM persistence as non-blocking, with a visible/logged CRM failure rather than silently holding all provider calls.
- Load only the child detail records belonging to the selected quote, rather than paging through every quote's details.

### Reliable saved quote loading

- Selecting a saved quote displays its persisted detail rows and never invokes a quote action or lookup flow.
- Persist an allowlisted, normalized result snapshot on each product detail so history can render after reload or after recent action runs expire. Store only fields required by the offer and coverage UI; do not persist raw provider payloads or unnecessary applicant data.
- Keep retry actions explicit. A failed/pending product may be retried only from its retry control, not as a side effect of opening history.
- Show a loading state while a quote's detail rows load and a clear error state if the read fails; do not present an empty result as a successful load.

### Deleting quote history

- Provide a delete action for a saved quote, with a confirmation step in the UI.
- Delete the quote's child detail rows first, then soft-delete the master record using its current version. If child deletion fails, retain the master and report the failure. Refresh the history list and clear the selected quote only after deletion succeeds.

## Acceptance criteria

1. Starting a quote does not wait for a full client collection scan before launching product flows.
2. Each selected product remains an independent flow and products continue to run concurrently.
3. The user can distinguish time spent preparing the quote from time spent waiting on each provider product.
4. Selecting a saved quote performs reads only, restores its persisted offer/coverage details, and does not rerun any insurer lookup or quote flow.
5. History loading fetches only details for the selected master quote.
6. A user can delete a saved quote; its details and master are removed in dependency order, and failures leave the master available for recovery.
7. Behavior and data-model changes are documented in the insurance quoting guide.

## Out of scope

- Grouping multiple products into one insurer execution.
- Changing provider flow definitions, insurer integrations, or the product catalog.
- Retrying failed products automatically.
- Persisting complete/raw provider responses or applicant form data in quote detail snapshots.
- Calling providers as part of history viewing.

## Implementation notes and risks

- Confirm the collection query API supports a safe equality filter on the quote relation. If it does not, add a narrowly scoped filter option to the plugin collection API and host rather than loading the entire detail collection.
- Normalize and allowlist snapshot fields from existing action results. Verify rendering does not accidentally treat absent historical action runs as empty coverage data.
- Use record versions for soft deletes and handle partial child deletion explicitly; a later retry should be able to finish deletion without hiding an undeleted master.
- Measure flow durations without logging applicant inputs or provider secrets.

## Verification expectations

- Add focused unit/contract coverage for filtered history reads, no-execution-on-select, result snapshot rendering, and ordered/partial deletion.
- Run the relevant insurance quote package and API contract checks, then typecheck the affected packages.
- Do not run live insurer lookups as part of verification.
