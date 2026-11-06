## Durable request recovery

Every execution first persists its operation, policy/carrier references, chosen connection, and stable provider idempotency key in the current workspace. Saved requests are immutable in the workbench: select one to query its status or retry the same key after resolving an unknown result. Creating a different request explicitly generates a new key. Before an external request, the screen checks that the persisted intent version and payload are unchanged. Provider acceptance is distinct from issuance or delivery confirmation.
