# Scoped security checks implementation plan

The approved change keeps CodeQL security analysis on relevant pull requests and
manual runs, removes its default push/weekly trigger, and makes Coverage manual.
No production operation, Cloudflare publication, scheduled task or polling is added.

- Implement a trusted-base selector for the existing Actions, JavaScript/TypeScript,
  Python and Rust analysis lanes. Include both paths for renames and fail selection
  on incomplete API evidence. Unknown files select all languages conservatively.
- Add an advanced CodeQL workflow with PR/manual triggers and per-PR cancellation.
  Each selected language scans the full repository, not just changed files.
- Remove Coverage's push trigger while preserving its tests and report jobs.
- Test selection, permissions and workflow wiring; update guides and Preview's
  deployment-tool allowlist so these orchestration files cannot trigger app releases.
- Preserve the remote default setup metadata, disable default setup only after the
  replacement is prepared, publish it, and verify a manual Actions scan uploads
  results. Verify automatic push scans and Coverage are absent.

Direct pushes no longer run CodeQL. Use the manual all-language scan for a release
checkpoint or a direct-to-main change that needs a new security baseline. Existing
alerts and analysis history are retained. CI's required tests stay unchanged.
