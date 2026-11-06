# Insurance accounting

Optional independent extension `insurance.accounting`. Register `extension` from `./manifest` (including runtime settings), `requirement` from `./object`, and `screens` from `./admin`. The collection is a navigation anchor; operational state lives in extension settings on the backend.

Finance operations require extension settings management permission and source collection read permission. The UI never stores state in browser storage. Version conflicts reject the whole aggregate replacement; reload and preview again. Sources are read-only snapshots, not transactional locks. No external financial side effects are performed.

See [finance operations](../../docs/insurance-finance.md) for constraints and workflows.
