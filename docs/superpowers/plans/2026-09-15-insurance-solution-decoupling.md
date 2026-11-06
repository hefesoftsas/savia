# Desacople de Seguros como solución low-code opcional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que Savia funcione sin código ni procesos de Seguros, mientras `savia.insurance` conserva la cotización con proveedores como solución y extensión opcionales.

**Architecture:** El núcleo expone contratos neutros de extensiones, conexiones y acciones; un catálogo de release entrega contribuciones first-party a API, Admin, MCP y el gateway de conectores sin que esos hosts importen Seguros. `savia.insurance` instala objetos declarativos y `insurance.quotes` aporta la configuración de conexiones, los adaptadores de cotización y sus vistas de resultados.

**Tech Stack:** TypeScript, Zod, Hono/OpenAPI, Cloudflare Workers/D1/R2, React, React Admin, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-15-insurance-solution-decoupling-design.md`

## Global Constraints

- No desplegar ni hacer push; cada commit de este plan permanece local.
- El núcleo no puede importar módulos de Seguros: la excepción única es el paquete de catálogo de release.
- Toda acción externa se autoriza por tenant y extensión antes de llegar al gateway; las extensiones nunca reciben D1, R2, `Env`, secretos ni un tenant elegido por el cliente.
- Las credenciales se guardan cifradas por `tenant_id + extension_id + connection_id` y nunca regresan al navegador tras guardarse.
- No mantener rutas `/v1/insurance-results`, proxy `/legacy-api`, `insurance.legacy` ni migración de datos antiguos.
- El reseteo de datos se limita al estado local generado de Savia. No borra secretos, fuentes PostgreSQL, archivos del repositorio ni servicios remotos.
- La cotización se inicia desde UI autorizada; MCP solo conserva contribuciones explícitamente de solo lectura.

---

## Estructura de archivos

| Ruta | Responsabilidad al finalizar |
| --- | --- |
| `packages/crm-shared/src/extension-runtime.ts` | Tipos y esquemas puros para contribuciones, conexiones, acciones y resultados. |
| `packages/crm-server/src/extension-connections.ts` | Persistencia cifrada y auditoría de conexiones por tenant/extensión. |
| `packages/crm-server/src/extension-actions.ts` | Rutas internas del CRM para configurar conexiones y ejecutar acciones instaladas. |
| `packages/db/migrations/0047_extension_runtime.sql` | Tablas `extension_connections`, `extension_connection_audit_events` y `extension_action_runs`. |
| `apps/connector-gateway/` | Worker interno genérico; ejecuta un adaptador registrado y no conoce aseguradoras. |
| `packages/release-catalog/` | Único ensamblador first-party de contribuciones de solución y extensión. |
| `packages/insurance-quotes/` | Manifiesto `insurance.quotes`, adaptadores, normalización, contribuciones Admin/MCP y pruebas de Seguros. |
| `solutions/insurance/manifest.json` | Paquete declarativo que requiere `insurance.quotes`, no `insurance.legacy`. |
| `apps/api/src/crm/collection-gateway.ts` | Inyecta el ejecutor genérico al CRM sin importar una extensión de industria. |
| `apps/admin/src/features/crm-engine/extension-*` | Host genérico de pantallas, acciones y conexiones de extensiones. |
| `apps/mcp/src/extensions/registry.ts` | Registra contribuciones MCP desde el catálogo de release. |
| `scripts/insurance-boundary.test.mjs` | Impide nuevas dependencias del núcleo hacia Seguros o legacy. |

## Interfaces que fijan los límites

Estas definiciones se crean en la Tarea 2 y se usan con los mismos nombres en
todas las tareas posteriores:

```ts
export type ExtensionActionContext = {
  tenantId: string;
  principalId: string;
  extensionId: string;
  actionId: string;
  connectionId: string;
  runId: string;
};

export type ExtensionActionExecutor = {
  execute(
    context: ExtensionActionContext,
    input: Record<string, unknown>,
  ): Promise<{ output: unknown; status: "succeeded" | "failed" }>;
};

export type ExtensionConnectorDefinition = {
  extensionId: string;
  connectorId: string;
  label: string;
  configurationSchema: z.ZodType<Record<string, unknown>>;
  secretFields: readonly string[];
};

export type ExtensionActionDefinition = {
  extensionId: string;
  actionId: string;
  connectorId: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
};
```

`packages/release-catalog` expone `releaseCatalog`, que contiene
`solutionCatalog`, `extensionRegistry`, `connectors`, `actions`, pantallas y
registradores MCP. Los hosts reciben ese valor, no importaciones a
`insurance-quotes` ni a `insurance-portfolio-dashboard`.

### Task 1: Caracterizar y bloquear el acoplamiento actual

**Files:**
- Create: `scripts/insurance-boundary.test.mjs`
- Modify: `package.json`
- Modify: `scripts/api-boundary.test.mjs`
- Test: `scripts/insurance-boundary.test.mjs`

**Interfaces:**
- Consumes: estructura actual de `apps/api`, `apps/admin`, `apps/mcp`,
  `apps/provider-gateway` y `apps/legacy-api`.
- Produces: los scripts `test:boundary:insurance` y `typecheck:core`, usados por
  las tareas 5 a 10.

- [ ] **Step 1: Escribir las pruebas de frontera que hoy deben fallar**

```js
const coreHosts = [
  "apps/api/src",
  "apps/admin/src",
  "apps/mcp/src",
  "apps/provider-gateway/src",
  "apps/connector-gateway/src",
].filter(existsSync);
assert.equal(
  forbiddenImports(coreHosts, ["insurance", "legacy-api"]),
  [],
);
```

La prueba debe excluir solo `packages/release-catalog/` del escaneo y debe
enumerar en su mensaje cada archivo y especificador prohibido. Añadir además
una prueba que `pnpm run typecheck:core` no seleccione `@savia/legacy-api`,
`@savia/insurance-quotes` ni `@savia/insurance-portfolio-dashboard`.

- [ ] **Step 2: Ejecutar la prueba para comprobar el estado rojo**

Run: `node --test scripts/insurance-boundary.test.mjs`

Expected: FAIL; el informe nombra los imports actuales de `insurance.legacy`,
`insurance-result-client`, `insurance-portfolio-dashboard` y `legacy-api`.

- [ ] **Step 3: Añadir los comandos de verificación sin falsear el resultado**

En `package.json`, añadir `test:boundary:insurance` que ejecute el archivo y
`typecheck:core` que incluya API, Admin, Auth, DB, crm-shared, crm-server, MCP,
connector-gateway y release-catalog. Mantener la prueba roja hasta la Tarea 9;
no poner excepciones adicionales en el escáner.

- [ ] **Step 4: Ejecutar los contratos de frontera existentes**

Run: `node --test scripts/api-boundary.test.mjs scripts/insurance-boundary.test.mjs`

Expected: el límite API existente pasa y el nuevo límite sigue fallando con los
consumidores identificados.

- [ ] **Step 5: Commit local del caracterizador**

```bash
git add package.json scripts/api-boundary.test.mjs scripts/insurance-boundary.test.mjs
git commit -m "test: characterize insurance coupling"
```

### Task 2: Crear el contrato neutro y la persistencia de extensiones

**Files:**
- Create: `packages/crm-shared/src/extension-runtime.ts`
- Create: `packages/crm-shared/test/extension-runtime.test.ts`
- Create: `packages/crm-server/src/extension-connections.ts`
- Create: `packages/crm-server/test/extension-connections.test.ts`
- Create: `packages/db/migrations/0047_extension_runtime.sql`
- Modify: `packages/crm-shared/src/extension-package.ts`
- Modify: `packages/crm-shared/package.json`
- Modify: `packages/crm-server/package.json`
- Modify: `packages/db/src/schema.ts`

**Interfaces:**
- Consumes: `ExtensionRegistry` y `crm_extension_installations` existentes.
- Produces: `ExtensionActionDefinition`, `ExtensionConnectorDefinition`,
  `ExtensionActionExecutor`, `ExtensionConnectionRepository` y las tablas que
  consumen las tareas 3 a 6.

- [ ] **Step 1: Escribir pruebas rojas para los tipos y la criptografía**

```ts
it("never returns connection secret fields in a summary", async () => {
  await repository.replace(connection, { apiKey: "secret", baseUrl: "https://x" });
  expect(await repository.summary(connection)).toEqual(
    expect.objectContaining({ configured: true, values: undefined }),
  );
});

it("rejects a connection for an inactive extension", async () => {
  await expect(repository.replace(connection, values)).rejects.toMatchObject({
    code: "EXTENSION_DISABLED",
  });
});
```

- [ ] **Step 2: Ejecutar las pruebas para verificar el fallo**

Run: `pnpm --filter @savia/crm-shared exec vitest run test/extension-runtime.test.ts && pnpm --filter @savia/crm-server exec vitest run test/extension-connections.test.ts`

Expected: FAIL porque el módulo, tablas y repositorio aún no existen.

- [ ] **Step 3: Implementar esquema, migración y repositorio mínimos**

`0047_extension_runtime.sql` crea `extension_connections` con clave primaria
`(tenant_id, extension_id, id)`, `connector_id`, ciphertext, IV, estado y
auditoría; crea `extension_action_runs` con `run_id`, los cuatro identificadores
de contexto, entrada/salida sanitizada, `pending|succeeded|failed|expired` y
código de error público. Crear índices por tenant/actualización y por
tenant/extensión/acción. El repositorio cifra y descifra solo mediante una clave
de entorno inyectada; sus métodos públicos son `list`, `replace`, `remove`,
`revealForExecution`, `startRun`, `completeRun` y `failRun`.

- [ ] **Step 4: Extender el registro con contribuciones de runtime**

Agregar a `TrustedExtension` una propiedad opcional `runtime` con arreglos de
conectores y acciones validados contra el `extensionId` del manifiesto. Rechazar
IDs duplicados, una acción que refiera un conector inexistente y campos secretos
que no estén en el esquema de configuración.

- [ ] **Step 5: Ejecutar pruebas y typecheck de paquetes**

Run: `pnpm --filter @savia/crm-shared exec vitest run test/extension-runtime.test.ts && pnpm --filter @savia/crm-server exec vitest run test/extension-connections.test.ts && pnpm --filter @savia/crm-shared exec tsc --noEmit && pnpm --filter @savia/crm-server exec tsc --noEmit && pnpm --filter @savia/db exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit local de contrato y almacenamiento**

```bash
git add packages/crm-shared packages/crm-server packages/db
git commit -m "feat: add generic extension runtime"
```

### Task 3: Exponer conexiones y acciones desde el host CRM

**Files:**
- Create: `packages/crm-server/src/extension-actions.ts`
- Create: `packages/crm-server/test/extension-actions.test.ts`
- Modify: `packages/crm-server/src/extensions.ts`
- Modify: `packages/crm-server/src/index.ts`
- Modify: `apps/api/src/crm/collection-gateway.ts`
- Modify: `apps/api/src/routes/dynamic-crm.ts`
- Modify: `apps/api/test/data-domains.test.ts`

**Interfaces:**
- Consumes: contrato y `ExtensionConnectionRepository` de la Tarea 2,
  `createCrmApp()` y la autorización de `registerDynamicCrmRoutes()`.
- Produces: las rutas internas `/api/extensions/:extensionId/connections` y
  `/api/extensions/:extensionId/actions/:actionId`, usadas por Admin y por el
  gateway de conectores.

- [ ] **Step 1: Escribir pruebas rojas de autorización y ciclo de ejecución**

```ts
expect(await app.request("/api/extensions/inventory.sync/actions/pull", {
  method: "POST", body: JSON.stringify({ connectionId: "main", input: {} }),
})).toHaveProperty("status", 403);

expect(executor.execute).toHaveBeenCalledWith(
  expect.objectContaining({ tenantId: "agency:7", extensionId: "inventory.sync" }),
  {},
);
```

Cubrir extensión ausente o desactivada (404), conector equivocado (422), entrada
inválida (422), ejecución exitosa (201) y fallo del gateway con solo un código
sanitizado (502).

- [ ] **Step 2: Ejecutar las pruebas rojas**

Run: `pnpm --filter @savia/crm-server exec vitest run test/extension-actions.test.ts`

Expected: FAIL porque las rutas y el ejecutor inyectable no existen.

- [ ] **Step 3: Implementar las rutas sin acoplamiento de industria**

Extender `ExtensionOptions` con `connectionRepository` y `actionExecutor`.
`registerExtensionActions()` verifica que el manifiesto está instalado y activo,
valida `connectionId` y `input` con la contribución de runtime, inserta el run
antes de delegar y siempre completa o falla el mismo `runId`. El request al CRM
mantiene el tenant que ya resolvió `registerDynamicCrmRoutes`; no admite
`tenantId`, `principalId` ni `extensionId` en el cuerpo.

- [ ] **Step 4: Pasar el contexto del API al CRM**

En `createCollectionGateway`, inyectar el `actionExecutor` configurado por el
runtime del API, sin importar un adaptador. Conservar el control actual de
membresía de `registerDynamicCrmRoutes` y usar el namespace de tenant existente
solo dentro del adaptador de ruta.

- [ ] **Step 5: Ejecutar pruebas de servidor y API**

Run: `pnpm --filter @savia/crm-server exec vitest run test/extension-actions.test.ts && pnpm --filter @savia/api exec vitest run test/data-domains.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit local del host de acciones**

```bash
git add packages/crm-server apps/api/src/crm/collection-gateway.ts apps/api/src/routes/dynamic-crm.ts apps/api/test/data-domains.test.ts
git commit -m "feat: host extension connections and actions"
```

### Task 4: Convertir el gateway de proveedores en gateway de conectores

**Files:**
- Rename: `apps/provider-gateway/` → `apps/connector-gateway/`
- Create: `apps/connector-gateway/src/registry.ts`
- Create: `apps/connector-gateway/test/registry.test.ts`
- Modify: `apps/connector-gateway/src/app.ts`
- Modify: `apps/connector-gateway/src/contracts.ts`
- Modify: `apps/connector-gateway/src/credential-vault.ts`
- Modify: `apps/connector-gateway/src/index.ts`
- Modify: `apps/connector-gateway/wrangler.jsonc`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/crm/collection-gateway.ts`
- Modify: `infra/cloudflare/*` and generated Worker binding types

**Interfaces:**
- Consumes: `ExtensionActionContext`, `ExtensionActionExecutor` y las tablas de
  la Tarea 2.
- Produces: binding interno `CONNECTOR_GATEWAY` y
  `ConnectorRegistry.execute(context, input)` para la Tarea 6.

- [ ] **Step 1: Escribir pruebas rojas del registro genérico**

```ts
it("executes only a registered extension action", async () => {
  await expect(registry.execute(context, {})).rejects.toMatchObject({
    code: "CONNECTOR_ACTION_NOT_FOUND",
  });
});

it("does not expose decrypted values in connector errors", async () => {
  await expect(registry.execute(context, {})).rejects.not.toThrow("secret-value");
});
```

- [ ] **Step 2: Ejecutar las pruebas para verificar el fallo**

Run: `pnpm --filter @savia/connector-gateway exec vitest run test/registry.test.ts`

Expected: FAIL porque todavía no existe el paquete ni el registro.

- [ ] **Step 3: Renombrar el Worker y reemplazar su contrato HTTP interno**

Usar `git mv` para preservar historial. Cambiar `/internal/execute` para aceptar
solo `{ tenantId, extensionId, actionId, connectionId, principalId, runId, input
}`. El gateway carga la conexión mediante `revealForExecution`, resuelve el
adaptador por `(extensionId, actionId)` y devuelve `{ status, output }` o un
código de error permitido. Eliminar las rutas `/internal/users/:principalId/providers/*`:
eran administración personal de proveedores y contradicen la pertenencia por
tenant definida en la especificación.

- [ ] **Step 4: Convertir el vault a conexiones por tenant/extensión**

Reemplazar identificadores `principalId + provider` por
`tenantId + extensionId + connectionId`. Mantener AES-GCM y redacción, pero
eliminar aliases de campos de vehículo, operaciones SBS y metadatos de
aseguradoras del Worker genérico.

- [ ] **Step 5: Crear la delegación de service binding desde API**

Agregar `CONNECTOR_GATEWAY?: { fetch(request: Request): Promise<Response> }`
al entorno de API. Implementar `connectorExecutorFromEnvironment()` que crea el
POST interno, comprueba la respuesta y traduce solo códigos permitidos. Pasar el
ejecutor a `createCollectionGateway`; nunca pasar la clave de cifrado al API.

- [ ] **Step 6: Ejecutar pruebas del Worker y contrato API–Worker**

Run: `pnpm --filter @savia/connector-gateway exec vitest run test/registry.test.ts test/app.test.ts test/credential-vault.test.ts && pnpm --filter @savia/api exec vitest run test/extension-actions-gateway.test.ts`

Expected: PASS; una acción sin registro, conexión o extensión activa falla sin
valores secretos.

- [ ] **Step 7: Commit local del gateway neutro**

```bash
git add apps/connector-gateway apps/api infra/cloudflare
git commit -m "refactor: make connector gateway extension-aware"
```

### Task 5: Crear un catálogo de release neutro y eliminar imports directos de hosts

**Files:**
- Create: `packages/release-catalog/package.json`
- Create: `packages/release-catalog/src/index.ts`
- Create: `packages/release-catalog/test/index.test.ts`
- Modify: `apps/api/src/extensions/catalog.ts`
- Modify: `apps/api/src/solutions/catalog.ts`
- Modify: `apps/admin/src/features/crm-engine/extension-screens.tsx`
- Modify: `apps/mcp/src/extensions/registry.ts`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Consumes: `TrustedExtension.runtime` y los módulos de contribución de las
  extensiones first-party.
- Produces: `releaseCatalog`, único valor permitido para que hosts descubran
  soluciones, extensiones, pantallas y registradores MCP.

- [ ] **Step 1: Escribir una prueba roja de ensamblado y aislamiento**

```ts
expect(releaseCatalog.extensionRegistry.ids()).toEqual([]);
expect(releaseCatalog.solutionCatalog).toEqual([]);
expect(source("apps/api/src/extensions/catalog.ts")).not.toMatch(/insurance/);
```

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `pnpm --filter @savia/release-catalog exec vitest run test/index.test.ts`

Expected: FAIL porque el catálogo neutral no existe y los hosts aún importan
Seguros directamente.

- [ ] **Step 3: Implementar catálogo neutral y adaptar hosts**

`releaseCatalog` inicia sin contribuciones y será el único punto de ensamblado
first-party. API obtiene `solutionOptions` de ese valor; Admin obtiene una lista
tipada de `ExtensionScreenContribution`; MCP itera registradores de solo
lectura. Eliminar de `apps/api/src/extensions/catalog.ts` la extensión built-in
`insurance.legacy` y los imports del dashboard. Sustituir
`apps/api/src/solutions/catalog.ts` por un adaptador neutral que reexporta las
opciones del catálogo.

- [ ] **Step 4: Ejecutar pruebas de catálogo y pantallas existentes**

Run: `pnpm --filter @savia/release-catalog exec vitest run test/index.test.ts && pnpm --filter @savia/api exec vitest run test/extensions.test.ts test/solution-packages.test.ts && pnpm --filter @savia/admin exec vitest run src/features/crm-engine/test/extension-screens.test.tsx`

Expected: PASS; el release vacío arranca y los hosts no importan código de
industria.

- [ ] **Step 5: Commit local del catálogo**

```bash
git add packages/release-catalog apps/api/src/extensions apps/api/src/solutions apps/admin/src/features/crm-engine/extension-screens.tsx apps/mcp/src/extensions/registry.ts pnpm-workspace.yaml
git commit -m "feat: add release catalog for first-party solutions"
```

### Task 6: Mover Seguros a la extensión `insurance.quotes`

**Files:**
- Create: `packages/insurance-quotes/package.json`
- Create: `packages/insurance-quotes/src/manifest.ts`
- Create: `packages/insurance-quotes/src/connectors.ts`
- Create: `packages/insurance-quotes/src/normalize.ts`
- Create: `packages/insurance-quotes/src/admin.ts`
- Create: `packages/insurance-quotes/test/connectors.test.ts`
- Create: `packages/insurance-quotes/test/normalize.test.ts`
- Modify: `solutions/insurance/manifest.json`
- Modify: `packages/insurance-portfolio-dashboard/src/manifest.ts`
- Modify: `packages/insurance-portfolio-dashboard/savia-extension.json`
- Modify: `packages/release-catalog/src/index.ts`
- Modify: `packages/release-catalog/test/index.test.ts`
- Modify: `apps/api/test/insurance-fixtures.ts`

**Interfaces:**
- Consumes: `ExtensionActionDefinition`, `ExtensionConnectorDefinition` y el
  catálogo de release neutro.
- Produces: manifiesto `insurance.quotes`, acción `quote` y contribuciones de
  presentación para las tareas 7 y 8.

- [ ] **Step 1: Escribir pruebas rojas para la acción de cotización**

```ts
it("normalizes an insurer response without leaking connector configuration", async () => {
  const result = await insuranceQuotes.execute(context, quoteInput);
  expect(result.output).toMatchObject({ type: "quote" });
  expect(JSON.stringify(result.output)).not.toContain("apiKey");
});

it("rejects a quote action with a connector from another extension", () => {
  expect(() => insuranceQuotes.action("quote", "inventory.sync")).toThrow();
});
```

- [ ] **Step 2: Ejecutar las pruebas rojas**

Run: `pnpm --filter @savia/insurance-quotes exec vitest run test/connectors.test.ts test/normalize.test.ts`

Expected: FAIL porque el paquete no existe.

- [ ] **Step 3: Reubicar comportamiento específico de Seguros**

Copiar primero contratos, normalizadores, flujos SBS, preparación de
solicitudes, metadatos Bruno, aliases de vehículo y redacción específicos desde
`apps/legacy-api/src/insurance-results/` y el antiguo gateway al paquete nuevo.
El adaptador exporta contribuciones de runtime para `insurance.quotes`; ninguna
de ellas depende de rutas Hono, `D1Database`, `Env` o componentes de Admin. El
origen legado permanece temporalmente hasta que Admin y MCP cambien en las
Tareas 7 y 8; se elimina en la Tarea 9.

- [ ] **Step 4: Cambiar dependencias de manifiestos**

Cambiar `solutions/insurance/manifest.json` para requerir
`insurance.quotes`. Eliminar cada referencia a `insurance.legacy` de fixtures,
manifiesto de cartera y registro. Añadir la solución, `insurance.quotes` y la
contribución de cartera al `releaseCatalog`. La cartera mantiene solo su
requisito de colección `polizas`, por lo que no requiere la acción de cotización.

- [ ] **Step 5: Ejecutar pruebas de Seguros y de soluciones**

Run: `pnpm --filter @savia/insurance-quotes exec vitest run && pnpm --filter @savia/api exec vitest run test/solution-packages.test.ts test/extensions.test.ts test/extension-actions-gateway.test.ts`

Expected: PASS; las últimas pruebas se actualizan para ejecutar
`insurance.quotes` por el host genérico, no `/v1/insurance-results`.

- [ ] **Step 6: Commit local de la solución de cotización**

```bash
git add packages/insurance-quotes packages/insurance-portfolio-dashboard solutions/insurance apps/api/test
git add packages/release-catalog
git commit -m "feat: move insurance quotes into extension"
```

### Task 7: Convertir Admin en host genérico de extensiones

**Files:**
- Create: `apps/admin/src/api/extension-runtime-client.ts`
- Create: `apps/admin/src/api/extension-runtime-client.test.ts`
- Create: `apps/admin/src/features/crm-engine/extension-connections.tsx`
- Create: `apps/admin/src/features/crm-engine/test/extension-connections.test.tsx`
- Modify: `apps/admin/src/features/crm-engine/extension-manager.tsx`
- Modify: `apps/admin/src/features/crm-engine/extension-screens.tsx`
- Modify: `apps/admin/src/features/crm-engine/request-page.tsx`
- Modify: `apps/admin/src/features/crm-engine/lookup-actions.tsx`
- Modify: `apps/admin/src/features/savia-request/standard-result.tsx`
- Modify: `apps/admin/src/app-services.ts`
- Delete: `apps/admin/src/api/insurance-result-client.ts`
- Delete: `apps/admin/src/api/provider-credentials-client.ts`
- Delete: `apps/admin/src/features/result-extensions/registry.ts`

**Interfaces:**
- Consumes: rutas de la Tarea 3 y contribuciones `admin` del catálogo de release.
- Produces: `ExtensionRuntimeClient`, UI de conexiones por tenant y renderer de
resultado resuelto por `extensionId`, sin tipos de Seguros en el host.

- [ ] **Step 1: Escribir pruebas rojas para una extensión ficticia**

```tsx
render(<ExtensionConnections extensionId="inventory.sync" client={client} />);
await user.click(screen.getByRole("button", { name: "Guardar conexión" }));
expect(client.replaceConnection).toHaveBeenCalledWith(
  "inventory.sync", "warehouse", expect.any(Object),
);
```

Agregar una prueba de `StandardResult` que recibe un renderer genérico del
catálogo y no contiene `insurancePresentation` ni `InsuranceResult`.

- [ ] **Step 2: Ejecutar las pruebas rojas**

Run: `pnpm --filter @savia/admin exec vitest run src/api/extension-runtime-client.test.ts src/features/crm-engine/test/extension-connections.test.tsx src/features/savia-request/standard-result.test.tsx`

Expected: FAIL porque cliente, panel y registro genérico no existen.

- [ ] **Step 3: Implementar cliente y panel de conexiones**

`ExtensionRuntimeClient` llama únicamente a la API del dominio activo:
`/extensions/:extensionId/connections` y
`/extensions/:extensionId/actions/:actionId`. El panel toma etiquetas y campos
del `ExtensionConnectorDefinition` del catálogo, muestra resúmenes sin valores y
reemplaza/elimina una conexión en el tenant activo.

- [ ] **Step 4: Delegar pantallas y resultados al catálogo**

Cambiar `extension-screens.tsx` para leer contribuciones tipadas de
`releaseCatalog`. `request-page.tsx`, `lookup-actions.tsx` y `standard-result.tsx`
solicitan un renderer por `extensionId` y renderizan JSON genérico cuando no hay
uno. Mover la vista rica de ofertas a `packages/insurance-quotes/src/admin.ts`.

- [ ] **Step 5: Retirar servicios personales de proveedor y resultados legados**

Quitar `insuranceResults` y `providerCredentials` de `AppServices`, sus mocks y
la generación OpenAPI legada. La configuración aparece únicamente en el panel
de una extensión instalada para el tenant actual.

- [ ] **Step 6: Ejecutar pruebas, typecheck y revisión visual local**

Run: `pnpm --filter @savia/admin exec vitest run src/api/extension-runtime-client.test.ts src/features/crm-engine/test/extension-connections.test.tsx src/features/crm-engine/test/extension-screens.test.tsx src/features/savia-request/standard-result.test.tsx && pnpm --filter @savia/admin exec tsc --noEmit`

Expected: PASS. En la app local verificar tres estados: sin Seguros no hay
acciones ni panel; con Seguros instalado se configura una conexión y se cotiza;
desactivado vuelve a ocultar las capacidades.

- [ ] **Step 7: Commit local del host Admin**

```bash
git add apps/admin packages/insurance-quotes
git rm apps/admin/src/api/insurance-result-client.ts apps/admin/src/api/provider-credentials-client.ts apps/admin/src/features/result-extensions/registry.ts
git commit -m "refactor: host insurance UI through extensions"
```

### Task 8: Registrar MCP solo mediante contribuciones de release

**Files:**
- Modify: `apps/mcp/src/extensions/registry.ts`
- Modify: `apps/mcp/src/extensions/insurance-portfolio-dashboard.ts`
- Delete: `apps/mcp/src/extensions/insurance-legacy.ts`
- Modify: `apps/mcp/test/server.test.ts`
- Modify: `apps/mcp/test/index.test.ts`
- Modify: `packages/insurance-quotes/src/mcp.ts`

**Interfaces:**
- Consumes: `releaseCatalog.assistantExtensions` y el contrato existente de
  `TrustedAssistantExtension`.
- Produces: registro MCP sin imports de la industria desde `apps/mcp`.

- [ ] **Step 1: Escribir la prueba roja de registro genérico**

```ts
expect(registeredTools).toContain("savia_extension_insurance_portfolio");
expect(registeredTools).not.toContain("savia_extension_insurance_quote");
```

La segunda expectativa protege la decisión de no exponer cotización de escritura
al modelo.

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `pnpm --filter @savia/mcp exec vitest run test/server.test.ts test/index.test.ts`

Expected: FAIL mientras el registro importa extensiones de Seguros directamente.

- [ ] **Step 3: Implementar el registro por catálogo**

Cambiar el arreglo `trustedAssistantExtensions` para que provenga de
`releaseCatalog.assistantExtensions`. Reubicar el resumen de cartera como
contribución read-only de su paquete y borrar `insurance-legacy`. Crear
`packages/insurance-quotes/src/mcp.ts` solo si necesita una consulta de lectura;
no registrar acciones de cotización ni credenciales.

- [ ] **Step 4: Ejecutar pruebas MCP y frontera**

Run: `pnpm --filter @savia/mcp exec vitest run test/server.test.ts test/index.test.ts && node --test scripts/insurance-boundary.test.mjs`

Expected: las pruebas MCP pasan; la frontera puede seguir roja únicamente por
Admin/API/legacy pendientes de la Tarea 9.

- [ ] **Step 5: Commit local del registro MCP**

```bash
git add apps/mcp packages/insurance-quotes packages/insurance-portfolio-dashboard
git rm apps/mcp/src/extensions/insurance-legacy.ts
git commit -m "refactor: load MCP extensions from release catalog"
```

### Task 9: Retirar runtime y consumidores legados

**Files:**
- Modify: `apps/admin/src/api/api-client.ts`
- Modify: `apps/admin/src/api/savia-data-provider.ts`
- Delete: `apps/admin/src/api/agency-data-provider.ts`
- Delete: `apps/admin/src/api/customer-data-provider.ts`
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/admin/scripts/generate-openapi-types.ts`
- Modify: `scripts/dev-local.sh`
- Modify: `scripts/dev-api-runtime.mjs`
- Modify: `apps/dev-router/wrangler.jsonc`
- Delete: `apps/dev-router/legacy-entry.ts`
- Delete: `scripts/legacy-api-local-proxy.mjs`
- Delete: `apps/legacy-api/` once no production consumer remains
- Modify: root `package.json`, README and affected CI/runtime tests

**Interfaces:**
- Consumes: host de acciones, catálogo, Admin y gateway de las tareas 3 a 8.
- Produces: un runtime local y producción compuestos solo por núcleo,
connector-gateway y paquetes opcionales.

- [ ] **Step 1: Escribir pruebas rojas de arranque sin legacy**

```js
assert.doesNotMatch(readFileSync("scripts/dev-local.sh", "utf8"), /legacy-api/);
assert.doesNotMatch(readFileSync("apps/admin/vite.config.ts", "utf8"), /legacy-api/);
assert.equal(existsSync("apps/legacy-api/src/index.ts"), false);
```

Agregar una prueba Admin que solicita un recurso de tenant y confirma que
`ApiClient.requestUrl()` no agrega el prefijo `/legacy-api`.

- [ ] **Step 2: Ejecutar las pruebas rojas**

Run: `node --test scripts/dev-api-runtime.test.mjs scripts/legacy-api-local-proxy.test.mjs scripts/insurance-boundary.test.mjs && pnpm --filter @savia/admin exec vitest run src/api/api-client.test.ts`

Expected: FAIL porque el proxy y consumidores siguen presentes.

- [ ] **Step 3: Retirar pantallas y providers de dominio legado**

Eliminar recursos `agencies` y `customers` de `createSaviaDataProvider`, sus
pantallas y pruebas asociadas; el paquete de Seguros provee sus colecciones
`clientes` y `aseguradoras` mediante CRM. Eliminar la lista `legacyDomains` y
el prefijo de `ApiClient`; todas las rutas de plataforma usan el Worker core.

- [ ] **Step 4: Retirar el segundo Worker y regenerar OpenAPI**

Quitar la configuración `LEGACY_API` del router/desarrollo, el proxy Vite y la
unión del documento OpenAPI legado. Cambiar las pruebas que importaban helpers
genéricos desde legacy por sus equivalentes ya existentes en `apps/api/src/crm`
o por pruebas de las colecciones low-code. Si un helper no tiene equivalente,
moverlo a `packages/crm-server` antes de borrar su origen y añadir su prueba en
ese paquete.

- [ ] **Step 5: Borrar los artefactos legados solo tras demostrar cero consumidores**

Run: `rg -n --glob '!apps/legacy-api/**' --glob '!apps/dev-router/**' 'legacy-api|LEGACY_API|/legacy-api|insurance\.legacy' apps packages scripts infra package.json`

Expected: cero coincidencias de código o configuración; solo pueden permanecer
referencias históricas en documentación fechada bajo `docs/superpowers/`.

Después, usar `git rm -r apps/legacy-api apps/dev-router` y borrar las pruebas,
scripts y contratos que únicamente cubrían esas rutas. Actualizar `pnpm
typecheck`, `pnpm test`, CI y README para no seleccionar esos paquetes.

- [ ] **Step 6: Ejecutar la frontera que debe pasar por primera vez**

Run: `node --test scripts/api-boundary.test.mjs scripts/insurance-boundary.test.mjs && pnpm run typecheck:core`

Expected: PASS; ningún host del núcleo importa Seguros ni código legacy.

- [ ] **Step 7: Commit local del corte de runtime**

```bash
git add apps/admin apps/api apps/connector-gateway scripts infra package.json README.md
git rm -r apps/legacy-api apps/dev-router
git commit -m "refactor: remove legacy insurance runtime"
```

### Task 10: Reiniciar estado local y comprobar el recorrido completo

**Files:**
- Create: `scripts/reset-savia-local-state.mjs`
- Create: `scripts/reset-savia-local-state.test.mjs`
- Modify: `scripts/dev-local.sh`
- Modify: `README.md`
- Modify: `docs/solution-packages.md`
- Test: `apps/api/test/extension-actions-gateway.test.ts`
- Test: `apps/admin/src/features/crm-engine/test/extension-connections.test.tsx`

**Interfaces:**
- Consumes: todos los contratos finalizados y el launcher local sin legacy.
- Produces: una base local reproducible y evidencia de que Plataforma y Seguros
se ejecutan independientemente.

- [ ] **Step 1: Escribir la prueba roja del reseteador acotado**

```js
const plan = resolveLocalStateReset(repository);
assert.deepEqual(plan.targets, [
  resolve(repository, "apps/api/.wrangler/state"),
  resolve(repository, "apps/auth/.wrangler/state"),
  resolve(repository, "apps/savia-request/.wrangler/state"),
]);
assert.equal(plan.targets.some((target) => target.includes("infra/secrets")), false);
```

- [ ] **Step 2: Ejecutar la prueba roja**

Run: `node --test scripts/reset-savia-local-state.test.mjs`

Expected: FAIL porque el reseteador no existe.

- [ ] **Step 3: Implementar un reseteador explícito y seguro**

El script requiere `--confirm-local-reset`, resuelve cada destino contra la raíz
del repositorio y rechaza cualquier ruta fuera de los tres directorios listados.
Por defecto solo imprime el plan; elimina estado únicamente con la bandera. No
se invoca desde `pnpm dev` automáticamente. Documentar el comando y que nunca
se ejecuta contra producción.

- [ ] **Step 4: Crear fixtures de recorrido completo**

En API, sembrar un tenant comercial sin soluciones; afirmar que `/api/extensions`
no muestra acciones de Seguros y que no hay objetos de la solución. Instalar
`savia.insurance`, guardar una conexión `insurance.quotes/sura-autos`, ejecutar
la acción `quote` con fetch falso y verificar un run normalizado. Desactivar la
extensión y confirmar 404 para acción/conexión mientras una colección genérica
sigue accesible.

- [ ] **Step 5: Ejecutar pruebas, typecheck y stack local**

Run: `node --test scripts/reset-savia-local-state.test.mjs scripts/insurance-boundary.test.mjs && pnpm --filter @savia/api exec vitest run test/extension-actions-gateway.test.ts test/solution-packages.test.ts && pnpm --filter @savia/admin exec vitest run src/features/crm-engine/test/extension-connections.test.tsx && pnpm run typecheck && pnpm test && sh scripts/verify-local-stack.sh`

Expected: PASS. Ejecutar luego el reseteador con la bandera solo tras inspeccionar
sus destinos impresos, iniciar `pnpm dev` y verificar visualmente los tres
estados definidos en la Tarea 7.

- [ ] **Step 6: Commit local de verificación y documentación**

```bash
git add scripts README.md docs/solution-packages.md apps/api/test apps/admin/src/features/crm-engine/test
git commit -m "test: verify optional insurance solution locally"
```

## Revisión final del plan

- Cobertura de especificación: Tareas 2–5 implementan núcleo, catálogo, datos y
  seguridad; Tarea 6 implementa Seguros y cotización; Tareas 7–8 integran Admin
  y MCP; Tarea 9 elimina compatibilidad; Tarea 10 valida el entorno de pruebas.
- Aislamiento: cada interfaz producida se declara antes de su primer consumidor;
  el único ensamblador que nombra Seguros es `packages/release-catalog`.
- Seguridad: las pruebas de Tareas 2–4 y 10 cubren tenant, extensión, conexión,
  redacción y códigos públicos de error.
- Datos: Tarea 10 limita el reset a estado local con confirmación explícita.
