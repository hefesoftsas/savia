# PostgreSQL SQL compatibility inventory

Docker selects its application database explicitly. The Cloudflare runtime defaults
to the SQLite dialect. PostgreSQL connections register their dialect once in the
native composition layer; authorization/history wrappers inherit it.

| Area                              | Implementation                                                                        | Verification                                            |
| --------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Parameters and results            | Lexical positional binding; explicit `RETURNING`; safe int8 and binary results        | Native database contract                                |
| JSON filters, sorts and ACL       | Typed JSON comparisons, scalar extraction, stable ordering and explicit text matching | Paired SQLite/PostgreSQL dialect and business contracts |
| Optimistic write guards           | Serializable batches and safe 409 conflicts; no implicit retry                        | Deterministic metadata and dependency races             |
| Schema and triggers               | Native versioned SQL with source inventory and checksums; guarded relation changes    | Native migrations and concurrent relation writes        |
| Collection metadata               | Native catalog inspection; SQLite keeps its metadata path                             | Database schema and tenant deletion tests               |
| History and local synchronization | Explicit JSON construction, timestamp and equality branches                           | CRUD/history/sync and offline import contracts          |
| Record bundles and relations      | Typed relation comparisons and JSONB snapshot equality                                | API regression and native relation tests                |
| Workflows                         | Dialect-aware typed queries and timestamps                                            | Native workflow persistence contract                    |
| Request store                     | Native conflict insertion and JSON soft-delete                                        | Native HTTP list/delete/reseed contract                 |
| Identity and authentication       | Native principal upsert and Better Auth PostgreSQL pool                               | Actual login, MFA, restart and import contracts         |

SQLite-only operators remain only behind dialect branches or in the SQLite
adapter/migration path. There is no general runtime SQL translation layer.
PostgreSQL rejects NUL and invalid Unicode before binding. Import validates each
source string, including overwritten JSON keys, before copying data. See
[self-hosted PostgreSQL](self-hosted-postgres.md) for operational limits.
