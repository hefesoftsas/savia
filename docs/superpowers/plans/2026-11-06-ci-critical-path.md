# CI critical path implementation plan

The approved goal is to shorten push-to-Preview validation without removing
applicable tests, changing production, or enabling scheduled activity.

## Design

Use a narrow `ci-config` profile for explicitly listed orchestration files. Keep
contracts and source-safety checks mandatory. Classifier, gate, dependency,
unknown and mixed application changes still run full CI. Execute the classifier
from the trusted base revision and retain the full fallback for older versions.

Split the measured Flows core serial chain across bounded independent jobs,
preserving its source-policy check, all package suites and fail-closed aggregate
gate. Inspect Admin test timings before changing its existing six shards; keep
the same runner count and every test. Avoid speculative cache or worker changes.

## Implementation and validation

- Add regression tests for the new profile, mixed paths and gate failures, then
  implement the classifier and update workflow output validation.
- Confirm Flows build/output dependencies, partition independent suites and test
  aggregate handling of failure, cancellation and skipped jobs.
- Use measured Admin timings to decide whether a low-risk rebalance is justified.
- Run focused tests, contracts and formatting; review the combined changes.
- Integrate and measure the complete CI/Preview chain. The first push still uses
  the previous trusted classifier. Follow with a real orchestration documentation
  update to verify the installed `ci-config` path. Confirm no app publication.

## Limits

No production changes, secret changes, pings, polling or scheduled scans. No local
recovery files are removed. A prior Auth revision mismatch needs separate evidence;
do not weaken revision checks or add blind retries as a latency optimization.
