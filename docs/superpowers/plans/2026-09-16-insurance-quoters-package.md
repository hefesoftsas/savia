# Cotizadores y administración de Seguros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el paquete opcional Seguros instale Cotizador, Cotizador por pasos y Administrar Seguros, con configuración aislada por tenant y los productos iniciales Producto 8, Gold y Plata.

**Architecture:** El núcleo añade solamente capacidades genéricas de configuración, conexiones y acciones de extensiones; el paquete `insurance.quotes` define el catálogo de productos, los flujos de proveedor y sus tres pantallas. Las dos experiencias de cotización comparten un formulario canónico y ejecutan acciones del host, mientras que la administración modifica una configuración validada por tenant sin exponer secretos.

**Tech Stack:** TypeScript, React 19, Vitest, Hono, Cloudflare D1, Zod, pnpm workspaces y Bruno como fuente versionada de contratos.

**Spec:** `docs/superpowers/specs/2026-09-16-insurance-quoters-package-design.md`

## Global Constraints

- Trabajar únicamente en la rama local `codex/tenant-user-invariant`; no hacer push ni despliegues remotos.
- No ejecutar ni probar llamadas reales a Sura, SBS ni otro proveedor externo.
- Las credenciales se guardan sólo cifradas en `extension_connections`; ninguna pantalla las lee, persiste en navegador o las vuelve a renderizar.
- El núcleo no puede importar ni nombrar conceptos de Seguros fuera del catálogo de release.
- Los productos configurables se limitan a las definiciones confiables de la extensión; la UI no acepta operation IDs arbitrarios.
- Una ejecución de proveedor se audita de forma saneada, pero no crea de manera automática un registro comercial en `cotizaciones`.
- La solución existente `savia.insurance` debe actualizarse sin borrar sus objetos, conexiones, configuraciones ni ejecuciones locales.

---

## File structure

| Ruta | Responsabilidad |
| --- | --- |
| `packages/crm-shared/src/extension-runtime.ts` | Contrato y validación de configuración declarada por una extensión confiable. |
| `packages/crm-shared/src/plugin-api.ts` | Fachada limitada que una pantalla de extensión usa para settings, conexiones y acciones de su propia extensión. |
| `packages/crm-server/migrations/0014_extension_settings.sql` | Persistencia D1 versionada de la configuración por `(tenant, extension)`. |
| `packages/crm-server/src/extension-settings.ts` | Repositorio de configuración con validación, versionado optimista, auditoría y aislamiento de tenant. |
| `packages/crm-server/src/extension-actions.ts` | Rutas genéricas de settings y control de acceso para cambios de configuración/conexiones. |
| `packages/crm-server/src/extensions.ts` | Tipos de opciones del runtime para repositorio de settings y autorización de administración. |
| `apps/api/src/crm/collection-gateway.ts` | Adaptador autenticado que identifica administradores de plataforma o del tenant. |
| `scripts/export-bruno-openapi.mjs` | Exportador con IDs deterministas y metadatos correctos para los tres flujos SBS confiables. |
| `packages/provider-contracts/index.{js,d.ts}` | Lista pública y tipada de operaciones iniciales permitidas. |
| `packages/insurance-quotes/src/sbs-product-flow.ts` | Ejecutor genérico de secuencias SBS con sesión efímera y pasos ordenados. |
| `packages/insurance-quotes/src/provider-executor.ts` | Selección del flujo SBS correcto y preparación de solicitudes a partir del formulario canónico. |
| `packages/insurance-quotes/src/normalize.ts` | Resultado tipado de cotización o consulta de vehículo, sin secretos. |
| `packages/insurance-quotes/src/configuration.ts` | Catálogo confiable, esquema Zod y valores iniciales de administración de Seguros. |
| `packages/insurance-quotes/src/screens/*.tsx` | Administración, formulario compartido, Cotizador y Cotizador por pasos. |
| `packages/insurance-quotes/src/admin.tsx` | Exporta las tres contribuciones de pantalla y conserva el renderer de resultados. |
| `solutions/insurance/manifest.json` | Versión de solución y sus tres entradas de navegación instalables. |
| `packages/release-catalog/src/index.ts` | Registro de las pantallas de Seguros junto a las contribuciones existentes. |

## Interfaces fijadas por el plan

```ts
// packages/crm-shared/src/extension-runtime.ts
export type ExtensionSettingsDefinition = {
  extensionId: string;
  schema: z.ZodType<Record<string, unknown>>;
  defaults: Record<string, unknown>;
};

// packages/crm-shared/src/plugin-api.ts
export type PluginSettings<T> = {
  value: T;
  version: number;
  updatedAt: string | null;
};

export type PluginApi = {
  settings: {
    get<T extends Record<string, unknown>>(): Promise<PluginSettings<T>>;
    replace<T extends Record<string, unknown>>(
      value: T,
      version: number,
    ): Promise<PluginSettings<T>>;
  };
  connections: {
    list(): Promise<ExtensionConnectionSummary[]>;
    replace(
      connectionId: string,
      value: { connectorId: string; values: Record<string, unknown> },
    ): Promise<void>;
    remove(connectionId: string): Promise<void>;
  };
  actions: {
    execute<T>(
      actionId: string,
      input: { connectionId: string; input: Record<string, unknown> },
    ): Promise<{ run: { runId: string; status: string }; output: T }>;
  };
  collections: PluginApiCollections;
  services: PluginApiServices;
};

// packages/insurance-quotes/src/configuration.ts
export type InsurancePackageSettings = {
  quotePages: { direct: boolean; wizard: boolean };
  vehicleLookup: { enabled: boolean; connectionId?: string };
  products: Array<{
    id: InsuranceQuoteProductId;
    label: string;
    connectionId?: string;
    enabled: boolean;
    rank: number;
  }>;
};
```

### Task 1: Persist and validate generic extension settings

**Files:**
- Create: `packages/crm-server/migrations/0014_extension_settings.sql`
- Create: `packages/crm-server/src/extension-settings.ts`
- Create: `packages/crm-server/test/extension-settings.test.ts`
- Modify: `packages/crm-shared/src/extension-runtime.ts`
- Modify: `packages/crm-shared/test/extension-runtime.test.ts`
- Modify: `packages/crm-shared/src/extension-package.ts`
- Modify: `packages/crm-server/src/extensions.ts`
- Modify: `packages/crm-server/src/index.ts`

**Interfaces:**
- Consumes: `ExtensionRegistry`, `isExtensionAvailable`, `ExtensionActionContext` and the existing D1 migration convention.
- Produces: `ExtensionSettingsDefinition`, `ExtensionSettingsRepository`, `ExtensionSettingsSnapshot`, and `ExtensionOptions.settingsRepository` for later routes and package screens.

- [ ] **Step 1: Write failing shared-runtime tests for a declared setting schema and defaults.**

```ts
it("retains settings only when their defaults satisfy the extension schema", () => {
  const registry = createExtensionRegistry([
    extension({
      settings: {
        extensionId: "inventory.sync",
        schema: z.object({ enabled: z.boolean() }).strict(),
        defaults: { enabled: true },
      },
    }),
  ]);

  expect(registry.get("inventory.sync")?.runtime?.settings?.defaults).toEqual({
    enabled: true,
  });
});
```

- [ ] **Step 2: Run the focused shared-runtime test and confirm the missing settings contribution fails.**

Run: `pnpm --filter @savia/crm-shared test -- extension-runtime.test.ts`

Expected: FAIL because `ExtensionRuntimeContribution` does not yet accept `settings`.

- [ ] **Step 3: Add the settings declaration to the extension runtime contract.**

```ts
export type ExtensionRuntimeContribution = {
  connectors?: readonly ExtensionConnectorDefinition[];
  actions?: readonly ExtensionActionDefinition[];
  settings?: ExtensionSettingsDefinition;
};

// validateExtensionRuntime must reject a mismatched extensionId and parse defaults.
const settings = runtime.settings;
if (settings) {
  if (settings.extensionId !== extensionId)
    throw new Error("La configuración pertenece a otra extensión.");
  settings.schema.parse(settings.defaults);
}
return { connectors, actions, ...(settings ? { settings } : {}) };
```

- [ ] **Step 4: Add the D1 table and the repository test fixture.**

```sql
CREATE TABLE extension_settings (
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  version INTEGER NOT NULL,
  created_by_principal_id TEXT NOT NULL,
  updated_by_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, extension_id)
);
CREATE INDEX extension_settings_tenant_updated_index
  ON extension_settings (tenant_id, updated_at DESC);
```

```ts
it("returns defaults until a tenant writes a validated versioned override", async () => {
  await expect(repository.get(key, definition)).resolves.toMatchObject({
    value: { enabled: true },
    version: 0,
  });

  await expect(
    repository.replace({ ...key, principalId: "admin-a", version: 0 }, definition, {
      enabled: false,
    }),
  ).resolves.toMatchObject({ value: { enabled: false }, version: 1 });
});
```

- [ ] **Step 5: Implement `ExtensionSettingsRepository` with tenant isolation and compare-and-swap updates.**

```ts
export type ExtensionSettingsSnapshot = {
  value: Record<string, unknown>;
  version: number;
  updatedAt: string | null;
};

async replace(key, definition, value): Promise<ExtensionSettingsSnapshot> {
  const parsed = definition.schema.parse(value);
  await this.assertActive(key.tenantId, key.extensionId);
  // Insert only for version 0; update only where the stored version equals key.version.
  // Return 409 through ExtensionRuntimeError when a concurrent writer changed it.
}
```

- [ ] **Step 6: Wire the repository through `ExtensionOptions` and createCrmApp without changing existing extensions.**

```ts
export type ExtensionOptions = {
  // existing registry, connectionRepository and actionExecutor options
  settingsRepository?: ExtensionSettingsRepository;
  canManageExtension?: (input: {
    tenantId: string;
    principalId: string;
    extensionId: string;
  }) => Promise<boolean> | boolean;
};
```

- [ ] **Step 7: Run the shared and server settings tests.**

Run: `pnpm --filter @savia/crm-shared test -- extension-runtime.test.ts && pnpm --filter @savia/crm-server test -- extension-settings.test.ts`

Expected: PASS; tests prove invalid defaults are rejected, tenant A cannot read tenant B, stale versions conflict, inactive extensions reject access, and default values are not written as credentials.

- [ ] **Step 8: Commit the generic settings foundation.**

```bash
git add packages/crm-shared/src/extension-runtime.ts \
  packages/crm-shared/src/extension-package.ts \
  packages/crm-shared/test/extension-runtime.test.ts \
  packages/crm-server/migrations/0014_extension_settings.sql \
  packages/crm-server/src/extension-settings.ts \
  packages/crm-server/src/extensions.ts \
  packages/crm-server/src/index.ts \
  packages/crm-server/test/extension-settings.test.ts
git commit -m "feat: add tenant extension settings"
```

### Task 2: Expose scoped host capabilities and enforce administrative writes

**Files:**
- Modify: `packages/crm-server/src/extension-actions.ts`
- Modify: `packages/crm-server/test/extension-actions.test.ts`
- Modify: `packages/crm-shared/src/plugin-api.ts`
- Modify: `packages/crm-shared/test/plugin-api.test.ts`
- Modify: `apps/api/src/crm/collection-gateway.ts`
- Create: `apps/api/test/collection-gateway-extension-admin.test.ts`

**Interfaces:**
- Consumes: `ExtensionSettingsRepository` and `ExtensionOptions.canManageExtension` from Task 1.
- Produces: scoped settings/connections/actions on `PluginApi`; `GET` and versioned `PUT /api/extensions/:extensionId/settings`; manager-only mutations for settings and connections.

- [ ] **Step 1: Add failing route tests for settings and for non-administrator connection writes.**

```ts
it("forbids a non-manager from changing an extension connection or settings", async () => {
  const response = await request("/extensions/inventory.sync/settings", "PUT", {
    value: { enabled: false },
    version: 0,
  }, { canManageExtension: () => false });

  expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Run the focused server route test and confirm it fails.**

Run: `pnpm --filter @savia/crm-server test -- extension-actions.test.ts`

Expected: FAIL because settings endpoints and the manager guard do not exist.

- [ ] **Step 3: Add settings routes and a single manager assertion in `extension-actions.ts`.**

```ts
async function assertManager(c, extensionId: string) {
  const allowed = await options.canManageExtension?.({
    tenantId: c.get("tenant"),
    principalId: c.get("principalId"),
    extensionId,
  });
  if (options.canManageExtension && !allowed)
    fail("No tienes permiso para administrar esta extensión.", 403);
}

app.get("/api/extensions/:extensionId/settings", async (c) => {
  await assertAvailable(...);
  await assertManager(c, extensionId);
  return c.json({ data: await settings.get(...) });
});
```

Apply `assertManager` to connection list/replace/remove and settings get/replace. Do not apply it to `POST .../actions/:actionId`, because quote execution belongs to the enabled screen permission, not to configuration administration.

- [ ] **Step 4: Write failing `PluginApi` translation tests.**

```ts
const savia = createPluginApi({ extensionId: "inventory.sync", request });
await savia.settings.replace({ enabled: false }, 3);
await savia.connections.replace("warehouse", {
  connectorId: "warehouse",
  values: { apiKey: "secret" },
});
await savia.actions.execute("pull", {
  connectionId: "warehouse",
  input: { since: "2026-09-16T00:00:00.000Z" },
});

expect(request).toHaveBeenCalledWith(
  "/extensions/inventory.sync/settings",
  "PUT",
  { value: { enabled: false }, version: 3 },
);
```

- [ ] **Step 5: Implement the Plugin API facades without leaking extension IDs or tenant IDs to package screens.**

```ts
settings: {
  get: () => request<HostData<PluginSettings<any>>>(
    `/extensions/${encodeURIComponent(extensionId)}/settings`, "GET",
  ).then(({ data }) => data),
  replace: (value, version) => request<HostData<PluginSettings<any>>>(
    `/extensions/${encodeURIComponent(extensionId)}/settings`, "PUT", { value, version },
  ).then(({ data }) => data),
},
```

Use the same extension-scoped path construction for connection and action methods. Preserve existing `collections` and `services` behavior unchanged.

- [ ] **Step 6: Pass the authenticated admin predicate from the API collection gateway.**

```ts
const managesCurrentTenant = () =>
  actor.globalRoles.includes("platform_admin") ||
  actor.memberships.some(
    (membership) =>
      membership.isActive &&
      (membership.tenantId ?? membership.agencyId) === Number(tenant.replace("agency:", "")) &&
      ["agency_admin", "tenant_admin"].includes(membership.role),
  );

createCrmApp(tenant, { ..., canManageExtension: managesCurrentTenant });
```

The test must use an operator and a tenant administrator against the same gateway and assert 403 versus success. Keep the existing outer dynamic CRM authorization intact.

- [ ] **Step 7: Run the capability and authorization suites.**

Run: `pnpm --filter @savia/crm-shared test -- plugin-api.test.ts && pnpm --filter @savia/crm-server test -- extension-actions.test.ts extension-settings.test.ts && pnpm --filter @savia/api test -- collection-gateway-extension-admin.test.ts`

Expected: PASS; only tenant/platform administrators may manage settings or connections, while scoped action execution remains available through its existing path.

- [ ] **Step 8: Commit the scoped host API.**

```bash
git add packages/crm-server/src/extension-actions.ts \
  packages/crm-server/test/extension-actions.test.ts \
  packages/crm-shared/src/plugin-api.ts \
  packages/crm-shared/test/plugin-api.test.ts \
  apps/api/src/crm/collection-gateway.ts \
  apps/api/test/collection-gateway-extension-admin.test.ts
git commit -m "feat: expose scoped extension administration"
```

### Task 3: Add Gold and Plata as trusted product flows

**Files:**
- Modify: `scripts/export-bruno-openapi.mjs`
- Modify: `scripts/export-bruno-openapi.test.mjs`
- Modify: `packages/provider-contracts/index.js`
- Modify: `packages/provider-contracts/index.d.ts`
- Modify: `packages/provider-contracts/index.test.mjs`
- Create: `packages/insurance-quotes/src/sbs-product-flow.ts`
- Create: `packages/insurance-quotes/test/sbs-product-flow.test.ts`
- Modify: `packages/insurance-quotes/src/provider-executor.ts`
- Modify: `packages/insurance-quotes/src/normalize.ts`
- Modify: `packages/insurance-quotes/test/normalize.test.ts`
- Modify: `packages/insurance-quotes/test/connectors.test.ts`
- Modify: `packages/insurance-quotes/src/provider-metadata.generated.ts`

**Interfaces:**
- Consumes: the Bruno folders `Producto-10-Gold` and `Producto-11-Plata`, canonical `vehicle`/`applicant` input and `ProviderExecutor.execute`.
- Produces: the start operation IDs `sbs-product-10-quote` and `sbs-product-11-quote`, explicit ordered step IDs for all three products, and a normalized `vehicle_lookup` result for Sura.

- [ ] **Step 1: Write failing flow and contract tests before adding any metadata.**

```ts
it.each([
  ["sbs-product-10-quote", 9, "sbs_product_10_session_id"],
  ["sbs-product-11-quote", 9, "sbs_product_11_session_id"],
])("runs %s through its ordered session flow", async (startId, stepCount, sessionKey) => {
  const executeStep = vi.fn()
    .mockResolvedValueOnce({ status: 200, data: "<No_Sesion>S-1</No_Sesion>" })
    .mockResolvedValue({ status: 200, data: "<ok />" });

  await executeSbsProductFlow(startId, executeStep);

  expect(executeStep).toHaveBeenCalledTimes(stepCount);
  expect(executeStep.mock.calls[1][1]).toEqual({ [sessionKey]: "S-1" });
});
```

```js
assert.deepEqual(activeAutoLightQuoteOperationIds, [
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
]);
```

- [ ] **Step 2: Run the focused tests and confirm the new starts are unavailable.**

Run: `pnpm --filter @savia/insurance-quotes test -- sbs-product-flow.test.ts && node --test packages/provider-contracts/index.test.mjs`

Expected: FAIL because the generic flow and new public operation IDs do not exist.

- [ ] **Step 3: Make Bruno export deterministic and allowlist only the required public operations.**

```js
const trustedGatewayOperations = new Map([
  ["06-Cotizaciones/Autos-livianos/Sura/031-sura-autos-provider.bru", "sura-vehicle-by-plate"],
  ["06-Cotizaciones/Autos-livianos/SBS/032-sbs-product-8-create-session.bru", "sbs-product-8-quote"],
  ["06-Cotizaciones/Autos-livianos/SBS/Producto-10-Gold/01.bru", "sbs-product-10-quote"],
  ["06-Cotizaciones/Autos-livianos/SBS/Producto-11-Plata/01.bru", "sbs-product-11-quote"],
]);

// Derive coverage and closing IDs from the same trusted Product 8/10/11 paths.
// Treat sbs_product_(8|10|11)_session_id as transient and all other
// sbs_product_(8|10|11)_* variables as text credentials.
```

The exporter test must assert 4 Product 8 metadata entries, 9 Gold entries, 9 Plata entries and the Sura lookup; it must also assert that Equidad, Liberty, Mapfre and research Bruno files are absent. Do not rely on basename-only IDs such as `01`.

- [ ] **Step 4: Regenerate the checked-in provider metadata and update public contracts.**

```js
export const publicProviderOperationIds = [
  "sura-vehicle-by-plate",
  "sbs-product-8-quote",
  "sbs-product-10-quote",
  "sbs-product-11-quote",
];
```

Run: `pnpm providers:types`

Confirm the generated file contains exactly the trusted operation families and no credential values.

- [ ] **Step 5: Implement a single SBS session-flow executor and dispatch it from `ProviderExecutor`.**

```ts
export const sbsProductFlows = {
  "sbs-product-8-quote": [
    "sbs-product-8-quote",
    "sbs-product-8-add-coverage-1",
    "sbs-product-8-add-coverage-2",
    "sbs-product-8-quote-and-close",
  ],
  "sbs-product-10-quote": [/* create, seven coverages, close */],
  "sbs-product-11-quote": [/* create, seven coverages, close */],
} as const;

export async function executeSbsProductFlow(startOperationId, executeStep) {
  const [createSession, ...steps] = sbsProductFlows[startOperationId];
  const sessionId = sessionIdFromSbsResponse((await executeStep(createSession)).data);
  if (!sessionId) throw new ExternalProviderUpstreamError("response");
  for (const operationId of steps)
    await executeStep(operationId, { [sessionVariableFor(startOperationId)]: sessionId });
}
```

`ProviderExecutor.execute` must dispatch only the three public SBS start IDs through this helper. It must not accept any internal coverage ID as a top-level user operation.

- [ ] **Step 6: Normalize the Sura lookup as a vehicle result and retain quote normalization for product flows.**

```ts
export type NormalizedInsuranceAction =
  | { type: "vehicle_lookup"; provider: string; status: "success" | "partial"; data: { vehicle: Vehicle | null } }
  | { type: "quote"; provider: string; status: "success"; data: unknown };

export function normalizeInsuranceAction(
  provider: string,
  operationId: string,
  response: unknown,
): NormalizedInsuranceAction { /* map placa/modelo/fasecolda/valorAsegurado safely */ }
```

Add test cases for matching plate, malformed year/value, missing vehicle, and redaction of secret-shaped keys. The connector test must assert that `sura-vehicle-by-plate` returns `type: "vehicle_lookup"` and a quote action returns `type: "quote"`.

- [ ] **Step 7: Run all provider and package-flow tests.**

Run: `node --test scripts/export-bruno-openapi.test.mjs packages/provider-contracts/index.test.mjs && pnpm --filter @savia/insurance-quotes test -- sbs-product-flow.test.ts connectors.test.ts normalize.test.ts provider-request-preparation.test.ts`

Expected: PASS; the 9-step sequences propagate a session only in memory, stop on failure, and never issue a tenth or retry request.

- [ ] **Step 8: Commit the provider flows.**

```bash
git add scripts/export-bruno-openapi.mjs scripts/export-bruno-openapi.test.mjs \
  packages/provider-contracts/index.js packages/provider-contracts/index.d.ts \
  packages/provider-contracts/index.test.mjs \
  packages/insurance-quotes/src/sbs-product-flow.ts \
  packages/insurance-quotes/src/provider-executor.ts \
  packages/insurance-quotes/src/normalize.ts \
  packages/insurance-quotes/src/provider-metadata.generated.ts \
  packages/insurance-quotes/test/sbs-product-flow.test.ts \
  packages/insurance-quotes/test/connectors.test.ts \
  packages/insurance-quotes/test/normalize.test.ts
git commit -m "feat: add Gold and Plata quote flows"
```

### Task 4: Define the package configuration and native screen contributions

**Files:**
- Create: `packages/insurance-quotes/src/configuration.ts`
- Create: `packages/insurance-quotes/test/configuration.test.ts`
- Modify: `packages/insurance-quotes/src/manifest.ts`
- Modify: `packages/insurance-quotes/src/connectors.ts`
- Modify: `packages/insurance-quotes/src/admin.tsx`
- Modify: `packages/insurance-quotes/package.json`
- Modify: `solutions/insurance/manifest.json`
- Modify: `packages/release-catalog/src/index.ts`
- Modify: `packages/release-catalog/test/index.test.ts`
- Modify: `packages/release-catalog/test/runtime.test.ts`
- Modify: `apps/admin/src/features/crm-engine/test/extension-screens.test.tsx`

**Interfaces:**
- Consumes: generic `runtime.settings` from Task 1 and the product operation IDs from Task 3.
- Produces: `insuranceQuoteSettingsDefinition`, `insuranceQuoteProductCatalog`, `insuranceQuoteScreens`, package version `1.1.0`, and the three installable solution objects.

- [ ] **Step 1: Write failing configuration tests for defaults, upgrade merging and forbidden product IDs.**

```ts
it("keeps existing tenant choices while appending a newly shipped product inactive", () => {
  expect(mergeInsuranceSettings({
    quotePages: { direct: false, wizard: true },
    vehicleLookup: { enabled: true, connectionId: "sura" },
    products: [{ id: "sbs-product-8", label: "Autos Producto 8", enabled: true, rank: 20 }],
  })).toMatchObject({
    quotePages: { direct: false, wizard: true },
    products: expect.arrayContaining([
      expect.objectContaining({ id: "sbs-product-10", enabled: false }),
      expect.objectContaining({ id: "sbs-product-11", enabled: false }),
    ]),
  });
});
```

- [ ] **Step 2: Run the configuration test and confirm the package settings module is missing.**

Run: `pnpm --filter @savia/insurance-quotes test -- configuration.test.ts`

Expected: FAIL because the settings schema and product catalog do not exist.

- [ ] **Step 3: Implement the trusted product catalog and its Zod settings schema.**

```ts
export const insuranceQuoteProductCatalog = [
  { id: "sbs-product-8", label: "Autos Producto 8", operationId: "sbs-product-8-quote", provider: "sbs" },
  { id: "sbs-product-10", label: "Autos Gold", operationId: "sbs-product-10-quote", provider: "sbs" },
  { id: "sbs-product-11", label: "Autos Plata", operationId: "sbs-product-11-quote", provider: "sbs" },
] as const;

export const insuranceQuoteSettingsDefinition = {
  extensionId: insuranceQuotesExtensionId,
  schema: insurancePackageSettingsSchema,
  defaults: defaultInsurancePackageSettings,
};
```

Defaults make both quote pages and the three shipped products visible, but leave every `connectionId` undefined. `mergeInsuranceSettings` must preserve existing enabled/order/connection choices and append a newly introduced catalog item with `enabled: false`.

- [ ] **Step 4: Declare settings in the extension manifest and ensure connector action input only permits the trusted starts and lookup.**

```ts
runtime: {
  settings: insuranceQuoteSettingsDefinition,
  connectors: [/* existing encrypted provider connector */],
  actions: [{
    extensionId: insuranceQuotesExtensionId,
    actionId: insuranceQuotesActionId,
    connectorId: insuranceQuotesConnectorId,
    inputSchema: insuranceActionInputSchema,
  }],
}
```

`insuranceActionInputSchema` accepts the canonical form for the three quote starts or `{ operationId: "sura-vehicle-by-plate", sura_test_plate }`. It rejects a coverage-step operation before provider execution.

- [ ] **Step 5: Add the three package objects and screen registrations.**

```json
{
  "name": "cotizador",
  "label": "Cotizador",
  "description": "Cotiza seguros de autos livianos.",
  "config": { "version": 2, "fields": {}, "fieldOrder": [] }
}
```

Add analogous `cotizador_por_pasos` and `administrar_seguros` objects, bump `savia.insurance` to `1.1.0`, and bump `insurance.quotes` to `1.1.0`. `admin.tsx` must export three contributions whose `extensionId` is `insurance.quotes`, objects are those names, and view is `records`. Merge these with the existing portfolio screens in the release catalog; do not move insurance imports into CRM host files.

- [ ] **Step 6: Add lifecycle and registry tests.**

```ts
expect(releaseCatalog.extensionScreens.map((screen) => screen.id)).toEqual([
  "insurance.portfolio-dashboard.policies",
  "insurance.quotes.direct",
  "insurance.quotes.wizard",
  "insurance.quotes.admin",
]);

expect(extensionScreenFor("cotizador", "records")?.extensionId).toBe(
  "insurance.quotes",
);
```

Add a server solution lifecycle assertion that updating an installed `savia.insurance` preserves its existing object records and adds the three new object definitions rather than recreating the tenant.

- [ ] **Step 7: Run package/configuration, catalog and screen registry tests.**

Run: `pnpm --filter @savia/insurance-quotes test -- configuration.test.ts connectors.test.ts && pnpm --filter @savia/release-catalog test && pnpm --filter @savia/admin test -- extension-screens.test.tsx && pnpm --filter @savia/crm-server test -- solutions.test.ts`

Expected: PASS; a tenant with the package active resolves all three screens, an inactive extension resolves none, and unsupported product IDs cannot be configured.

- [ ] **Step 8: Commit package registration and configuration.**

```bash
git add packages/insurance-quotes/src/configuration.ts \
  packages/insurance-quotes/src/manifest.ts \
  packages/insurance-quotes/src/connectors.ts \
  packages/insurance-quotes/src/admin.tsx \
  packages/insurance-quotes/test/configuration.test.ts \
  solutions/insurance/manifest.json \
  packages/release-catalog/src/index.ts \
  packages/release-catalog/test/index.test.ts \
  packages/release-catalog/test/runtime.test.ts \
  apps/admin/src/features/crm-engine/test/extension-screens.test.tsx \
  packages/crm-server/test/solutions.test.ts
git commit -m "feat: register insurance quote package screens"
```

### Task 5: Build the shared quote UI, wizard and administrative screen

**Files:**
- Create: `packages/insurance-quotes/src/screens/quote-form.tsx`
- Create: `packages/insurance-quotes/src/screens/quote-result.tsx`
- Create: `packages/insurance-quotes/src/screens/quote-workspace.tsx`
- Create: `packages/insurance-quotes/src/screens/quote-wizard.tsx`
- Create: `packages/insurance-quotes/src/screens/insurance-admin.tsx`
- Create: `apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx`
- Modify: `packages/insurance-quotes/src/admin.tsx`

**Interfaces:**
- Consumes: `PluginApi` from Task 2, `InsurancePackageSettings`/product catalog from Task 4, and normalized actions from Task 3.
- Produces: `InsuranceQuoteWorkspaceScreen`, `InsuranceQuoteWizardScreen`, `InsurancePackageAdminScreen`, and no browser persistence of applicant or vehicle data.

- [ ] **Step 1: Write failing UI tests from the package user flows.**

```tsx
it("removes lookup-derived vehicle values when the user changes the plate", async () => {
  render(<InsuranceQuoteWorkspaceScreen savia={configuredSavia} />);
  await user.type(screen.getByLabelText("Placa"), "TESTCAR");
  await user.click(screen.getByRole("button", { name: "Consultar placa" }));
  expect(await screen.findByDisplayValue("04408010")).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Placa"));
  await user.type(screen.getByLabelText("Placa"), "SECONDID");
  expect(screen.queryByDisplayValue("04408010")).not.toBeInTheDocument();
});

it("keeps a successful offer if a selected product fails", async () => {
  render(<InsuranceQuoteWorkspaceScreen savia={partiallyFailingSavia} />);
  // fill canonical valid input and submit Product 8 plus Gold
  expect(await screen.findByText("Autos Producto 8")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Autos Gold");
});
```

- [ ] **Step 2: Run the new UI test and confirm the screens do not exist.**

Run: `pnpm --filter @savia/admin test -- insurance-quote-screens.test.tsx`

Expected: FAIL because package screens are not exported or rendered.

- [ ] **Step 3: Implement the canonical form and result components with no persistence side effects.**

```ts
export const quoteFields = [
  "vehicle.plate", "vehicle.fasecoldaCode", "vehicle.productionYear",
  "vehicle.isNew", "vehicle.circulationCity", "vehicle.accessoriesValue",
  "vehicle.declaredValue", "applicant.documentType",
  "applicant.documentNumber", "applicant.firstName", "applicant.surname",
  "applicant.secondSurname", "applicant.gender", "applicant.birthDate",
  "applicant.city", "applicant.address", "applicant.phone", "applicant.email",
] as const;

export function clearVehicleLookup(form: QuoteForm): QuoteForm {
  return { ...form, "vehicle.fasecoldaCode": "", "vehicle.productionYear": "", "vehicle.declaredValue": "", "vehicle.accessoriesValue": "0" };
}
```

The lookup button must call `savia.actions.execute(insuranceQuotesActionId, ...)` only after an explicit click. Apply returned vehicle fields only for an exact normalized plate match. Render field-level validation and use accessible labels, status messages, buttons and alerts.

- [ ] **Step 4: Implement the direct workspace and product execution behavior.**

```tsx
const results = await Promise.all(
  selectedProducts.map(async (product) => {
    try {
      return { product, result: await savia.actions.execute<NormalizedInsuranceAction>("quote", {
        connectionId: product.connectionId,
        input: { operationId: product.operationId, ...canonicalQuoteInput(form) },
      }) };
    } catch (error) {
      return { product, error: publicMessage(error) };
    }
  }),
);
```

Guard against empty product selection, missing assigned connection and missing settings. Show every result/error in product rank order. Do not write `cotizaciones`, `localStorage`, session storage or browser history.

- [ ] **Step 5: Implement the three-step wizard as a composition of the same form.**

```ts
export const quoteWizardSteps = [
  { id: "vehicle", title: "Vehículo", fields: vehicleFields },
  { id: "applicant", title: "Solicitante y conductor", fields: applicantFields },
  { id: "contact", title: "Contacto y cotización", fields: contactFields },
] as const;
```

Validate only the current step on “Continuar”, preserve entered values when moving backward, keep lookup in the first step, and expose product selection/submission only in the third. Reuse the direct workspace execution helper so a fix to input mapping changes both screens together.

- [ ] **Step 6: Implement `Administrar Seguros` through the scoped Plugin API.**

```tsx
const snapshot = await savia.settings.get<InsurancePackageSettings>();
await savia.settings.replace(nextSettings, snapshot.version);
await savia.connections.replace(connectionId, {
  connectorId: insuranceQuotesConnectorId,
  values: { provider, credentials },
});
```

Render concise status cards for the two pages, the plate lookup and each catalog product. Use switches for activation, a rank input/select for order, connection selectors built from `savia.connections.list()`, and an explicit save action that handles a version conflict by reloading the saved configuration. The connection form must use `type="password"` for credentials and clear its input after save; list entries only show identifier, connector and updated time.

- [ ] **Step 7: Run the UI suite and inspect package behavior with mocked actions.**

Run: `pnpm --filter @savia/admin test -- insurance-quote-screens.test.tsx`

Expected: PASS; direct and wizard variants send identical canonical inputs, inactive products are hidden, a mismatched plate is ignored, one failed product does not remove another result, and administration never renders a saved secret.

- [ ] **Step 8: Commit the package UI.**

```bash
git add packages/insurance-quotes/src/screens \
  packages/insurance-quotes/src/admin.tsx \
  apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx
git commit -m "feat: add insurance quote screens"
```

### Task 6: Verify install/update lifecycle and the local application

**Files:**
- Modify: `packages/crm-server/test/solutions.test.ts`
- Modify: `apps/admin/src/features/crm-engine/test/solution-manager.test.tsx`
- Modify: `docs/runbooks/bruno-runner-migration-status.md`

**Interfaces:**
- Consumes: all implementation tasks and the existing solution installation/activation endpoints.
- Produces: evidence that the current local tenant can update Seguros safely and that the package is usable without any external provider call.

- [ ] **Step 1: Add a failing end-to-end lifecycle test for the installed solution.**

```ts
it("updates installed Seguros without deleting records and exposes all package screens", async () => {
  await installInsurance("tenant-insurance");
  await createExistingClientRecord("tenant-insurance");
  await updateInsuranceTo("1.1.0", "tenant-insurance");

  expect(await objectNames("tenant-insurance")).toEqual(
    expect.arrayContaining(["clientes", "cotizador", "cotizador_por_pasos", "administrar_seguros"]),
  );
  expect(await clientRecordCount("tenant-insurance")).toBe(1);
});
```

- [ ] **Step 2: Run the lifecycle test and confirm it fails until package upgrade behavior is complete.**

Run: `pnpm --filter @savia/crm-server test -- solutions.test.ts`

Expected: FAIL if an installed `1.0.0` solution does not reconcile the new manifest objects while retaining tenant data.

- [ ] **Step 3: Implement the smallest reconciliation adjustment required by the failing test.**

```ts
// In the existing solution installation transaction, preserve compatible rows and records.
// For each manifest object missing from crm_objects, insert its definition and schema version.
// Do not DELETE crm_records, extension_connections, extension_settings or extension_action_runs.
```

Do not add an ad-hoc migration for insurance objects; reuse the normal solution install/update transaction so future optional packages receive the same behavior.

- [ ] **Step 4: Add an admin solution-manager test for the post-install entry points.**

```tsx
expect(await screen.findByText("Cotizador")).toBeInTheDocument();
expect(screen.getByText("Cotizador por pasos")).toBeInTheDocument();
expect(screen.getByText("Administrar Seguros")).toBeInTheDocument();
```

The inactive-package variant must assert that all three entries are absent.

- [ ] **Step 5: Update the Bruno runbook with the local-only proof boundary.**

```md
## Package cotizadores (local)

- Gold and Plata are executed only with mocked `fetch` in tests.
- The package configuration references encrypted connections by ID.
- No local test invokes the real Sura or SBS endpoint.
```

- [ ] **Step 6: Run focused lifecycle tests, formatting, typecheck and all related unit suites.**

Run: `pnpm --filter @savia/crm-server test -- solutions.test.ts extension-actions.test.ts extension-settings.test.ts && pnpm --filter @savia/admin test -- solution-manager.test.tsx insurance-quote-screens.test.tsx && pnpm --filter @savia/insurance-quotes test && pnpm --filter @savia/release-catalog test && pnpm typecheck && pnpm exec prettier --check packages/crm-shared packages/crm-server apps/api/src/crm packages/insurance-quotes packages/release-catalog solutions/insurance/manifest.json docs/runbooks/bruno-runner-migration-status.md`

Expected: PASS with no real provider requests and no formatting violations.

- [ ] **Step 7: Do a local visual verification without submitting an external request.**

1. Open the local app and install/update Seguros through Paquetes y extensiones.
2. Confirm the navigation displays Cotizador, Cotizador por pasos and Administrar Seguros.
3. Open Administrar Seguros, confirm the default products and both page toggles, and verify a missing connection shows guidance rather than a request.
4. Use mocked development transport or the focused UI test harness to inspect lookup/result/error states; do not press a control that calls a real provider.
5. Disable Seguros and confirm the three entries disappear while unrelated CRM screens remain available.

- [ ] **Step 8: Inspect the final diff and commit verification artifacts.**

```bash
git diff --check
git status --short
git add packages/crm-server/test/solutions.test.ts \
  apps/admin/src/features/crm-engine/test/solution-manager.test.tsx \
  docs/runbooks/bruno-runner-migration-status.md
git commit -m "test: verify insurance quote package lifecycle"
```

Do not push the branch. Report the exact commands and results from the final verification.

## Plan self-review

- **Spec coverage:** Tasks 1–2 deliver versioned, tenant-isolated settings, scoped plugin APIs and administrator-only mutations. Task 3 provides the three source-derived product flows and Sura lookup normalization. Task 4 makes the package installable and configurable. Task 5 supplies the direct, wizard and administrative UIs. Task 6 verifies installation/update, privacy, deactivation and local visual behavior without external calls.
- **Placeholder scan:** The plan contains no deferred design decisions, generic “handle errors” instructions or unbound operation IDs. The allowed products, settings shape, endpoints, error behavior and verification commands are explicit.
- **Type consistency:** `ExtensionSettingsDefinition` is introduced before `ExtensionSettingsRepository`, which is passed through `ExtensionOptions` before `PluginApi.settings` calls it. `InsurancePackageSettings` is defined before screens consume it. The three product IDs map consistently from catalog to public operation to the SBS flow executor.
