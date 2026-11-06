# Insurance finance operations

These three optional extensions provide bounded operational finance tools. They are not platform-core assumptions. Install collections and commissions before using the corresponding finance workspace. Users need extension-management permission to persist finance settings and read access to source collections. The collection created by each extension is a worklist navigation anchor, not a second ledger.

## Bank reconciliation (`insurance.payments`)

Import a UTF-8 CSV with exactly `id,date,reference,amount` as the header. Dates use ISO calendar days and amounts use a decimal point with at most two decimal places. Only positive incoming payments are supported. Quoted CSV cells and doubled quotes are supported. Choose a stable bank-account identifier; transaction identity is account plus bank-provided ID. Reusing that identity, within an import or across imports, rejects the complete import. Different accounts may reuse bank IDs. Changing the account label bypasses that identity boundary, so use the same canonical account label for all imports.

Preview every row before confirmation. Select an unallocated transaction, an obligation, and a partial amount. Matching policy references are ordered first as suggestions, never automatically posted. Allocation checks both the transaction's unallocated amount and the source obligation's current outstanding amount minus all local allocations. A fresh source read precedes each allocation. All movements and allocations share one backend aggregate, so a version conflict rejects the entire update and concurrent imports cannot both win against the same version. A CSV reconciliation report includes residual differences; zero residual indicates fully allocated.

The aggregate supports 200 transactions and 1,000 allocations. There is no rollover, deletion, reversal, debit import, automatic bank feed, or automatic posting to the source obligation. Stop using this bounded ledger when capacity is reached; do not clear settings to reuse transaction IDs. Allocations are a reconciliation subledger. Do not also post the same receipt manually to `paid` in the source while continuing reconciliation: that would count it twice when computing available obligation balance. External source edits can invalidate prior allocations and are not transactionally locked by this workspace.

## Settlements (`insurance.settlements`)

Select commission records, enter a share percentage, and optionally apply a signed adjustment to the complete batch. The base is received commission, rounded half-up per line using integer cents and integer basis points. Preview displays seller/responsible party, source commission, share, and the batch payable including adjustment. A negative total is rejected. Confirming stores the source IDs and versions with the calculated lines; a source changed since preview is rejected. Export the saved statement as CSV.

Each source commission can be included once across saved batches. The calculation rejects zero and partial receipts: the received amount must be positive and equal the expected commission before settlement. Later receipts against an already settled source cannot be incrementally settled. The adjustment is a batch-level amount, not silently assigned to a seller. No payout is executed and source commissions are not mutated. Capacity is 50 batches, at most 200 commissions each.

## Accounting (`insurance.accounting`)

Select unexported collection obligations and enter two different ledger accounts. The preview creates an equal debit and credit for each obligation's full amount. Confirming saves an immutable export batch after checking source versions. Export its reference, source ID, account, debit, and credit as CSV. Each obligation can occur in only one saved batch; re-downloading a saved batch is allowed and does not create another posting.

This is an invoice/receivable export preparation tool, not fiscal invoice issuance. The operator must supply the appropriate accounts. Tax calculation, jurisdictional invoice numbering, credit notes, general-ledger posting, payment posting, and provider transmission are not implemented. External accounting connectors remain optional until a provider and posting contract are configured. Capacity is 50 batches, at most 200 obligations each.

## Consistency and integration

All money calculations use safe integer minor units with BigInt intermediate arithmetic. CSV exports neutralize formula-leading text. Each extension persists one bounded settings aggregate through the host's optimistic version API. Settings schemas reject malformed payloads, duplicate source use, and inconsistent totals. This provides atomicity for each finance aggregate only: source reads and finance saves are separate operations and are not a cross-collection transaction. Re-read previews after conflicts. No automatic retry overwrites another manager's changes.

Register `extension` (not only `manifest`) from each package's manifest export, its object `requirement`, and its admin `screens`. The runtime settings registration is necessary for schema validation and initial defaults. Uninstalling or resetting extension settings must be governed as removal of operational finance data. There is no external connector requirement for CSV workflows.
