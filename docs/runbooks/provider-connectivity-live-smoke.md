# Provider connectivity live smoke test

This runbook distinguishes deterministic gateway tests from external smoke tests. The deterministic suite uses injected responses and must remain stable. The smoke test invokes the configured local gateway and records only status and safe error categories.

## Command

```sh
node scripts/provider-connectivity-live-smoke.mjs \
  --agency 10 --attempts 3 --max-requests 10 \
  --plate <authorized-test-vehicle-registration>
```

The runner requires an operator-supplied `--plate` value and never retains a
vehicle registration in source control. It counts the maximum request cost of
token and sequence calls before execution. It never schedules more than ten
HTTP requests for a provider. `--provider <id>` can resume one provider without
consuming another provider's allowance. A response body or configured value is
never printed.

## Active scope

Sura's vehicle lookup is a one-request operation. SBS Producto 8 is a
four-request sequence (create session, two coverage additions, quote/close),
so the runner schedules at most two SBS attempts under the ten-request ceiling.
It sends a synthetic test quote and never prints the request, response, session
identifier, or provider configuration.

The reproducibility evidence was recorded in the retired Expertia validation
runbook (removed with the Bruno toolchain).
The current SBS budget is already partly consumed, so do not run its smoke test
until a fresh per-provider test budget is available.

## Historical result: 2026-09-03

These earlier observations predate the SBS Producto 8 validation above and do not change the retained catalog.

| Provider               |                              Attempts | Result                             |
| ---------------------- | ------------------------------------: | ---------------------------------- |
| Equidad vehicle lookup |                                     3 | 3 × 200                            |
| Equidad quote          |                                     3 | 3 × 200                            |
| Sura vehicle lookup    |                                     3 | 3 × 200                            |
| Allianz quote          | 3 after correcting the archive parser | 3 × 502 upstream                   |
| Bolívar quote          |             5, maximum budget reached | 2 timeouts, then 3 × 502 upstream  |
| HDI quote              |                                     3 | 3 × 502 upstream                   |
| Liberty quote          |                                     3 | 3 × 502 upstream                   |
| Mapfre quote           |                                     3 | 3 timeouts                         |
| SBS session            |                                     3 | 3 × 502 upstream                   |
| Zurich quote           |                                     3 | 3 × 404 credentials not configured |

Zurich is intentionally unconfigured because the supplied archive has no create-quote or token endpoint. Allianz now reaches the upstream stage; its reference archive requires a client certificate, which is not a Worker credential value.
