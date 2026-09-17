# Savia CRM engine

Motor del CRM dinámico embebido en Savia. La interfaz vive en `/#/crm` del
admin; la API autenticada expone el runtime a través de Savia
(`/v1/data-domains/*`, `/v1/dynamic-crm/*`).

El motor está repartido en tres piezas:

- **UI React** (este directorio, `apps/admin/src/features/crm-engine`):
  diseñador, formularios y registros.
- **Servidor Hono** (`packages/crm-server`, `createCrmApp`): lo consume el API.
- **Metadata, validación y utilidades** (`packages/crm-shared`): compartido
  por el admin y el API.

## Desarrollo local

Desde la raíz del monorepo:

```sh
pnpm dev
```

Eso levanta el admin en `http://127.0.0.1:5173` con el CRM en `/#/crm`. No hace
falta un servidor CRM aparte: `pnpm dev` aplica la migración
`0022_dynamic_crm.sql` en el D1 de Savia.

Para credenciales de integraciones externas, configura `CRM_INTEGRATION_KEY`
(al menos 32 caracteres) en `apps/api/.dev.vars`.

## Verificación

```sh
pnpm --filter @savia/admin test
pnpm --filter @savia/crm-server test
pnpm --filter @savia/crm-shared test
pnpm --filter @savia/crm-server typecheck
pnpm --filter @savia/crm-shared typecheck
```

Las pruebas del motor usan D1/R2 efímeros de Wrangler contra `createCrmApp()`
en modo de prueba local (`POC_LOCAL=true` en
`packages/crm-server/wrangler.jsonc`). No levantan un frontend independiente.

Contratos operativos del motor: [API.md](/packages/crm-server/API.md).
Integraciones OpenAPI: [INTEGRATIONS.md](/packages/crm-server/INTEGRATIONS.md).
