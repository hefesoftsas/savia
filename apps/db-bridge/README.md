# db-bridge

Puente Node entre la API de Savia (Workers/D1, sin TCP a Postgres) y bases
PostgreSQL externas. Solo lectura (`SELECT` parametrizado, transacción
`read_only`, `statement_timeout` 10s).

## Protocolo

- `GET /health` → `{ok:true}` (sin auth).
- `POST /introspect` `{connection, table?}` → `{tables}` o
  `{schema, table, kind, columns, primaryKey}`.
- `POST /query` (esquema `bridgeQuerySchema` en
  `packages/crm-shared/src/sql-sources.ts`) → `{data, total?, page, perPage, hasNext}`.

Auth: `Authorization: Bearer $DB_BRIDGE_SHARED_SECRET`.

## Entorno

| Variable | Descripción |
| --- | --- |
| `DB_BRIDGE_SHARED_SECRET` | Obligatorio. Igual que `SQL_BRIDGE_SECRET` en la API. |
| `DB_BRIDGE_PORT` | Por defecto `8791`. Escucha solo local; expón vía proxy/red privada. |
| `DB_BRIDGE_ALLOWED_HOSTS` | Lista `host1,host2` permitida. `*` (defecto, solo desarrollo). |

## Desarrollo local

```sh
# Terminal 1: puente (alcanza al Postgres local/Docker)
DB_BRIDGE_SHARED_SECRET=dev-secret-cambia-esto \
DB_BRIDGE_ALLOWED_HOSTS='*' \
pnpm --filter @savia/db-bridge dev

# Terminal 2: API (el launcher propaga SQL_BRIDGE_*)
SQL_BRIDGE_URL=http://127.0.0.1:8791 \
SQL_BRIDGE_SECRET=dev-secret-cambia-esto \
pnpm dev
```

Sin `SQL_BRIDGE_URL`/`SQL_BRIDGE_SECRET` la API funciona igual, pero las
fuentes Postgres responden `503`.

## Seguridad

- Identificadores (schema/tabla/columna) validados por zod antes de
  interpolarse entrecomillados; valores siempre parametrizados (`$1...`).
- Usa un rol Postgres **read-only** (`GRANT SELECT`) por fuente.
- La API nunca guarda la contraseña en claro: va cifrada en
  `crm_collection_sources.encrypted_secret` y solo viaja al puente por
  HTTPS/red privada con Bearer.
- Savia nunca emite DDL contra el externo; el esquema se mantiene con las
  herramientas del sistema dueño (igual que NocoBase).
