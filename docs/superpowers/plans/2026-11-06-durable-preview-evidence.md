# Durable Preview evidence and concurrent CI

The approved change preserves successful runtime, Office and store references
outside Actions history, and overlaps contract execution with focused runtime
validation. Production, schedules, polling and local recovery files stay unchanged.

## Implementation

1. Record component success in GitHub Deployments with an exact source revision,
   repository, Preview environment, component and workflow-run identity. Preserve
   the current Actions artifacts for compatibility. Record aggregate equivalence
   only after every required component job succeeds.
2. Read durable receipts before legacy Actions evidence. Verify identity and git
   ancestry independently for each component. Reject incomplete/failed receipts;
   fail the planning job on API errors instead of starting an expensive full release.
3. Migrate the last completed release from preserved local job evidence, cross-
   checked against its surviving successful GitHub environment deployment. Do not
   invent a baseline or rerun backups just to populate the receipt store.
4. Execute contracts concurrently with runtime-profile and plugin validation.
   Keep the required Contract tests check as a final gate that rejects failed,
   cancelled or unexpectedly skipped dependencies.
5. Run focused and complete contract checks, review the combined diff, then
   validate the trusted main workflow in Preview and record actual timings.

## Verification

Test receipt identity, ancestry, failure, automatic inactivation, independent
component advancement, pagination and API failures. Prove that an empty Actions
run history still yields the verified deployed baseline. Test the required gate
for relevant and irrelevant profile lanes. Preserve all production configurations
and retain the existing full-release fallback for unknown application changes.
