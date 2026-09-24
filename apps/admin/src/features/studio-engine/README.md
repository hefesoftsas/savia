# Savia Studio engine

Motor low-code embebido en Savia (antes "CRM dinámico"). La interfaz vive en
`/#/studio` del admin (`/#/crm` sigue como alias heredado); la API
autenticada expone el runtime a través de Savia (`/v1/data-domains/*`,
`/v1/dynamic-crm/*`).

El motor está repartido en tres piezas:

- **UI React** (este directorio, `apps/admin/src/features/studio-engine`):
  diseñador, formularios y registros.
- **Servidor Hono** (`packages/studio-server`, `createStudioApp`): lo consume
  el API.
- **Metadata, validación y utilidades** (`packages/studio-shared`): compartido
  por el admin y el API.

## Desarrollo local

Desde la raíz del monorepo:

```sh
pnpm dev
```

Eso levanta el admin en `http://127.0.0.1:5173` con Studio en `/#/studio`. No
hace falta un servidor aparte: `pnpm dev` aplica la migración
`0022_dynamic_crm.sql` en el D1 de Savia.

Para credenciales de integraciones externas, configura `CRM_INTEGRATION_KEY`
(al menos 32 caracteres) en `apps/api/.dev.vars`. El nombre de la variable
se conserva a propósito (secretos de despliegue existentes).

## Verificación

```sh
pnpm --filter @savia/admin test
pnpm --filter @savia/studio-server test
pnpm --filter @savia/studio-shared test
pnpm --filter @savia/studio-server typecheck
pnpm --filter @savia/studio-shared typecheck
```

Las pruebas del motor usan D1/R2 efímeros de Wrangler contra
`createStudioApp()` en modo de prueba local (`POC_LOCAL=true` en
`packages/studio-server/wrangler.jsonc`). No levantan un frontend
independiente.

Contratos operativos del motor: [API.md](/packages/studio-server/API.md).
Integraciones OpenAPI: [INTEGRATIONS.md](/packages/studio-server/INTEGRATIONS.md).
