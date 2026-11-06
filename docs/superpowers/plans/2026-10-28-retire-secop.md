# SECOP retirement implementation plan

Goal: remove the optional SECOP integration and its provisioning paths while retaining historical data and shared platform capabilities.

- [x] Inventory the package, source preset, tenant artifacts, cleanup targets and separate infrastructure repository.
- [x] Remove the package and preset; retain generic MCP and monitor regression coverage.
- [x] Archive installed SECOP package metadata and sources before removing active installations and catalog entries. Preserve business data.
- [x] Remove SECOP deletion targets and obsolete bundle patching utilities from Savia.
- [ ] Retire deployment entry points in the external infrastructure repository without destroying retained resources.
- [ ] Run targeted and contract checks, review diffs, publish PRs, require successful CI and merge.
- [ ] Verify preview receives the merged revision and SECOP is absent, subject to the existing account spending pause.

Verification must cover preservation of unrelated plugins and records, archive completeness, generic MCP connections and plugin monitors. Deployment must inspect the exact Wrangler configuration and retain the account spending guard and OpenRouter constraints.
