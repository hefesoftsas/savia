# Insurance service plugins implementation plan

**Goal:** Extend optional insurance coverage with issuance tracking, document
requirements and customer service requests, using the established workbench.
**Architecture:** Three independently installed collections and screen packages;
release-catalog remains the only composition point. No platform schema changes.
**Design:** Preserve the shared Operate layout and theme. Show deadlines, workload
and status before opening an inline editor. Keep fields labeled, required-stage
rules visible, records versioned and errors recoverable.

## Scope and rules

- Issuance: requested, underwriting, issued, delivered or cancelled. Issued cases
  remain open until delivered. Issued/delivered require policy reference and issue
  date; delivered also requires delivery date; cancellation requires a reason.
  Coverage end follows start; issuance follows request; delivery follows issuance.
- Documents: requested, received, changes requested, approved or waived. Received,
  changes and approved require an evidence reference. Reviews require received and
  reviewed dates. Approved/changes/waived require an outcome. Request, receipt and
  review dates are chronological. Each record represents one document requirement.
- Service: received, in progress, waiting, resolved or cancelled. Record category,
  channel, owner and an explicitly entered response deadline. Resolution requires
  date and outcome; cancellation requires an outcome. No implied statutory SLA.
- Dates are calendar dates. Due dates cannot precede request/receipt dates.
- Use text references to existing files/cases. No attachment transfer, external
  submission, email, automatic policy creation or legal/compliance determination.
- All three use tenant-scoped host APIs, optimistic versions and backend-only
  persistence. Required-stage fields are also expressed in backend metadata.

## Execution

- [x] Write domain tests for required completion evidence and chronology, observe
      failures, implement independent manifests, fields and validation.
- [x] Add themed screens with workflow-specific metrics and columns. Register
      packages, dependencies, typecheck commands and exact catalog contracts.
- [x] Extend API installation, stale-write, backend-required-field and isolation
      tests; add UI creation, invalid close, correction and persistence coverage.
- [x] Run package/UI/API tests, types and production build. Review actual screens
      at desktop/mobile sizes with synthetic data and resolve material findings.
- [x] Update coverage guide, package three ZIPs and record verification evidence.

## Review focus

Partial closure updates must retain backend requirements. An issued policy is not
marked delivered without delivery evidence. Document rejection is actionable, not
closed. Dates with impossible calendar values must fail. Closed service requests
must not inflate overdue totals. Existing plugins must keep their current contracts.

## Evidence

[Validation report](../../archive/2026-09-19-insurance-service-validation.md).
