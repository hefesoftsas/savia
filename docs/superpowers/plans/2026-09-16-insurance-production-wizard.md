# Cotizador de Seguros equivalente a producción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar el cotizador de tres pasos dentro del paquete Seguros, con resultados actualizables, simulación segura y administración de sus productos y conexiones.

**Architecture:** Un asistente React de Seguros concentra formulario, pasos y resultados; ambas entradas delegan en él. El núcleo recibe sólo dos extensiones genéricas del runtime: ejecutar una acción declarada sin conexión cuando ésta lo permite y listar las ejecuciones saneadas del usuario para la extensión actual. El adaptador de Seguros conserva las integraciones reales y añade una simulación determinista que no llega a red.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, Hono, Cloudflare D1, Zod, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-16-insurance-production-wizard-design.md`

## Global Constraints

- Trabajar únicamente en la rama local `codex/tenant-user-invariant`; no hacer push ni despliegues.
- No modificar producción ni usar credenciales o llamadas reales durante pruebas, comprobación visual o desarrollo.
- Seguros permanece contenido en `@savia/insurance-quotes`; el runtime genérico no adquiere lenguaje de aseguradoras, vehículos o cotizaciones.
- Las conexiones continúan cifradas y las rutas/UI nunca devuelven secretos ni la entrada completa del formulario.
- La ruta `cotizador` debe reutilizar el asistente de `cotizador_por_pasos`; no crear un formulario directo duplicado.
- Las simulaciones se auditan, se etiquetan como tales y no ejecutan HTTP.
- Las ejecuciones reales no crean registros de `cotizaciones` automáticamente.

---

## File structure

| Ruta | Responsabilidad |
| --- | --- |
| `packages/crm-shared/src/extension-runtime.ts` | Declara que una acción puede omitir conexión. |
| `packages/crm-shared/src/plugin-api.ts` | Expone `actions.list()` y conexión opcional para acciones permitidas. |
| `packages/crm-server/src/extension-connections.ts` | Persiste y lista ejecuciones saneadas, filtradas por tenant, extensión y actor. |
| `packages/crm-server/src/extension-actions.ts` | Rutas para historial y ejecución sin conexión sólo cuando la acción lo declara. |
| `apps/connector-gateway/src/registry.ts` | Evita descifrar conexión en una acción que declara que no la requiere para esa entrada. |
| `packages/insurance-quotes/src/connectors.ts` | Ejecuta proveedor real o respuesta simulada determinista. |
| `packages/insurance-quotes/src/screens/quote-input.ts` | Contrato, valores iniciales, validación por paso y conversión del formulario. |
| `packages/insurance-quotes/src/screens/quote-wizard.tsx` | Asistente de tres pasos, consulta de placa, productos, modo y recarga de resultados. |
| `packages/insurance-quotes/src/screens/quote-results.tsx` | Renderiza resultados por producto y errores parciales. |
| `packages/insurance-quotes/src/screens/quote-screens.tsx` | Carga de configuración, entradas reutilizadas y administración de Seguros. |
| `packages/insurance-quotes/src/screens/quote-screens.css` | Apariencia compacta, responsive y accesible del paquete. |
| `apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx` | Pruebas de UI de las pantallas aportadas por el paquete. |
| `solutions/insurance/manifest.json` | Versión de solución actualizada para la instalación local. |

### Task 1: Exponer acciones opcionales y el historial seguro de una extensión

**Files:**

- Modify: `packages/crm-shared/src/extension-runtime.ts`
- Modify: `packages/crm-shared/src/plugin-api.ts`
- Modify: `packages/crm-shared/test/plugin-api.test.ts`
- Modify: `packages/crm-server/src/extension-connections.ts`
- Modify: `packages/crm-server/src/extension-actions.ts`
- Modify: `packages/crm-server/test/extension-connections.test.ts`
- Modify: `packages/crm-server/test/extension-actions.test.ts`
- Modify: `apps/connector-gateway/src/registry.ts`
- Modify: `apps/connector-gateway/test/registry.test.ts`

**Interfaces:**

- Consumes: las tablas existentes `extension_action_runs` y `extension_connections`.
- Produces: `PluginExtensionActionRun`, `PluginApi.actions.list`, `ExtensionConnectionRepository.listRuns`, `ExtensionActionDefinition.connectionOptional` y `ConnectorActionAdapter.requiresConnection`.

- [ ] **Step 1: Añadir las pruebas que fallen para la ruta y cliente de historial.**

```ts
it("lists only the caller's sanitized runs for its extension", async () => {
  await connections.startRun(context, { email: "ana@example.test" });
  await connections.completeRun(context, { quoteNumber: "Q-1", apiKey: "x" });
  await connections.startRun({ ...context, extensionId: "other.sync", runId: "other" }, {});

  await expect(connections.listRuns({ tenantId: "tenant-a", extensionId: "inventory.sync", principalId: "user-a", limit: 20 })).resolves.toEqual([
    expect.objectContaining({ runId: context.runId, output: { quoteNumber: "Q-1", apiKey: "[redacted]" } }),
  ]);
});

it("maps actions.list to the owning extension", async () => {
  const savia = createPluginApi({ extensionId: "inventory.sync", request: async (path, method) => {
    expect([path, method]).toEqual(["/extensions/inventory.sync/actions/runs?limit=20", "GET"]);
    return { data: [] };
  }});
  await expect(savia.actions.list()).resolves.toEqual([]);
});
```

- [ ] **Step 2: Ejecutar las pruebas focalizadas y confirmar que fallan porque no existen `listRuns` ni `actions.list`.**

Run: `pnpm --filter @savia/crm-shared test -- plugin-api.test.ts && pnpm --filter @savia/crm-server test -- extension-connections.test.ts`

Expected: FAIL con errores de tipos o métodos ausentes `actions.list` y `listRuns`.

- [ ] **Step 3: Definir el contrato público y el repositorio de lectura sin entrada del formulario.**

```ts
export type PluginExtensionActionRun = {
  runId: string;
  actionId: string;
  connectionId: string;
  status: "pending" | "succeeded" | "failed" | "expired";
  output: unknown;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

async listRuns(key: { tenantId: string; extensionId: string; principalId: string; limit: number }): Promise<PluginExtensionActionRun[]> {
  const rows = await this.database.prepare(
    "SELECT run_id,action_id,connection_id,status,output,error_code,created_at,updated_at FROM extension_action_runs WHERE tenant_id=? AND extension_id=? AND principal_id=? ORDER BY updated_at DESC,run_id DESC LIMIT ?",
  ).bind(key.tenantId, key.extensionId, key.principalId, key.limit).all<StoredRun>();
  return rows.results.map((row) => ({
    runId: row.run_id, actionId: row.action_id, connectionId: row.connection_id,
    status: row.status as PluginExtensionActionRun["status"],
    output: row.output ? JSON.parse(row.output) : null, errorCode: row.error_code,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}
```

Add `actions.list(options = {})` in `createPluginApi`; clamp `limit` to an integer from 1 to 100 and request `GET /extensions/:extensionId/actions/runs?limit=<value>`. Change the execute input to `{ connectionId?: string; input: Record<string, unknown> }`, because only a declared `connectionOptional` action can omit it. Do not add `input` to the public run type or SELECT list.

- [ ] **Step 4: Añadir la ruta con aislamiento de actor y cobertura de límites.**

```ts
app.get("/api/extensions/:extensionId/actions/runs", async (c) => {
  const extensionId = c.req.param("extensionId");
  await assertAvailable(c.env.DB, c.get("tenant"), extensionId, registry);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 20) || 20));
  return c.json({ data: await connections.listRuns({
    tenantId: c.get("tenant"), extensionId, principalId: c.get("principalId"), limit,
  })});
});
```

Extend `extension-actions.test.ts` with one run written for `user-a` and one for `user-b`; assert that `GET /extensions/inventory.sync/actions/runs?limit=20` returns only `user-a`, omits `input`, and returns 404 before installation.

- [ ] **Step 5: Escribir pruebas fallidas para una simulación que no descifra conexión y para rechazo de una acción normal sin conexión.**

```ts
it("does not reveal a connection when the adapter marks this input optional", async () => {
  const revealForExecution = vi.fn();
  const registry = new ConnectorRegistry({ revealForExecution }, [{
    extensionId: "inventory.sync", actionId: "preview",
    requiresConnection: (input) => input.mode !== "mock",
    execute: async ({ connection }) => ({ connection }),
  }]);
  await expect(registry.execute({ ...context, actionId: "preview", connectionId: "simulation" }, { mode: "mock" })).resolves.toMatchObject({ status: "succeeded" });
  expect(revealForExecution).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Implementar la omisión explícita de conexión, sin ampliar permisos de las demás acciones.**

```ts
export type ExtensionActionDefinition = {
  extensionId: string; actionId: string; connectorId: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  connectionOptional?: boolean;
};

export type ConnectorActionAdapter = {
  extensionId: string; actionId: string;
  requiresConnection?(input: Record<string, unknown>): boolean;
  execute(input: { context: ExtensionActionContext; connection: Record<string, unknown>; input: Record<string, unknown> }): Promise<unknown>;
};
```

In `extension-actions.ts`, parse `connectionId` as optional. If it is absent and `!action.connectionOptional`, return 422. If absent and allowed, set `context.connectionId` to the reserved literal `simulation` and skip `connections.summary`. If supplied, retain the existing connection ownership and connector checks. In `ConnectorRegistry.execute`, call `adapter.requiresConnection?.(input) ?? true`; reveal only when that result is true and otherwise pass `{}`. An adapter that receives `mode: "live"` with `connectionId: "simulation"` still fails when it asks the repository to reveal that non-existent connection.

- [ ] **Step 7: Ejecutar las suites de runtime y gateway.**

Run: `pnpm --filter @savia/crm-shared test -- plugin-api.test.ts && pnpm --filter @savia/crm-server test -- extension-connections.test.ts extension-actions.test.ts && pnpm --filter @savia/connector-gateway test -- registry.test.ts`

Expected: PASS. Las pruebas demuestran listado aislado, ausencia de entrada/secretos y que sólo una acción declarada opcional evita descifrado.

- [ ] **Step 8: Commit del runtime genérico.**

```bash
git add packages/crm-shared/src/extension-runtime.ts packages/crm-shared/src/plugin-api.ts packages/crm-shared/test/plugin-api.test.ts packages/crm-server/src/extension-connections.ts packages/crm-server/src/extension-actions.ts packages/crm-server/test/extension-connections.test.ts packages/crm-server/test/extension-actions.test.ts apps/connector-gateway/src/registry.ts apps/connector-gateway/test/registry.test.ts
git commit -m "feat: expose extension action history"
```

### Task 2: Construir el contrato de cotización y el adaptador de simulación

**Files:**

- Create: `packages/insurance-quotes/src/screens/quote-input.ts`
- Create: `packages/insurance-quotes/test/quote-input.test.ts`
- Modify: `packages/insurance-quotes/src/connectors.ts`
- Modify: `packages/insurance-quotes/src/manifest.ts`
- Modify: `packages/insurance-quotes/test/connectors.test.ts`

**Interfaces:**

- Consumes: `insuranceQuoteProductCatalog`, `normalizeInsuranceAction`, la acción genérica con `connectionOptional` y los contratos de proveedor existentes.
- Produces: `AutoLightQuoteInput`, `QuoteFormValues`, `validateQuoteStep`, `toAutoLightQuoteInput`, y salida simulada normalizada.

- [ ] **Step 1: Añadir pruebas puras para defaults, placa y validación por paso.**

```ts
it("normalizes the plate and blocks a vehicle step with missing required data", () => {
  expect(updateQuoteValue(defaultQuoteFormValues, "vehicle.plate", " testcar ").vehicle.plate).toBe("TESTCAR");
  expect(validateQuoteStep(defaultQuoteFormValues, "vehicle")).toEqual(expect.objectContaining({
    "vehicle.plate": "Ingresa la placa.", "vehicle.fasecoldaCode": "Ingresa el código Fasecolda.",
  }));
});

it("clears lookup fields when the plate changes", () => {
  const withLookup = applyVehicleLookup({ ...defaultQuoteFormValues, vehicle: { ...defaultQuoteFormValues.vehicle, plate: "TESTCAR", fasecoldaCode: "123" } }, { plate: "TESTCAR", productionYear: 2024, currency: "COP" });
  expect(updateQuoteValue(withLookup, "vehicle.plate", "TESTALT").vehicle).toMatchObject({ plate: "TESTALT", fasecoldaCode: "", productionYear: null });
});
```

- [ ] **Step 2: Ejecutar el test y confirmar que falla por módulo inexistente.**

Run: `pnpm --filter @savia/insurance-quotes test -- quote-input.test.ts`

Expected: FAIL con `Cannot find module '../src/screens/quote-input'`.

- [ ] **Step 3: Implementar el modelo inmutable del formulario.**

```ts
export const quoteSteps = [
  { id: "vehicle", title: "Vehículo" },
  { id: "applicant", title: "Solicitante y conductor" },
  { id: "contact", title: "Contacto y cotización" },
] as const;

export function toAutoLightQuoteInput(values: QuoteFormValues): AutoLightQuoteInput {
  return { vehicle: { ...values.vehicle, productionYear: Number(values.vehicle.productionYear), accessoriesValue: Number(values.vehicle.accessoriesValue), declaredValue: Number(values.vehicle.declaredValue) }, applicant: { ...values.applicant } };
}
```

Implement `updateQuoteValue` without mutation. For a changed `vehicle.plate`, clear `fasecoldaCode`, `productionYear`, `declaredValue` and `accessoriesValue` only when those values originated from `applyVehicleLookup`; retain user-entered values otherwise. `validateQuoteStep` returns a keyed Spanish error object and `validateQuote` merges the three steps.

- [ ] **Step 4: Añadir pruebas fallidas para simulación y para ejecución real conservada.**

```ts
it("returns a deterministic simulated quote without invoking the provider", async () => {
  const executeProviderQuote = vi.fn();
  const quotes = createInsuranceQuotes({ executeProviderQuote });
  const result = await quotes.execute({ ...context, connectionId: "simulation" }, { mode: "mock", operationId: "sbs-product-8-quote", vehicle: { plate: "TESTCAR" } });
  expect(result.output).toMatchObject({ type: "quote", status: "success" });
  expect(executeProviderQuote).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Implementar la rama de simulación sin secretos.**

```ts
function isSimulation(input: Record<string, unknown>): boolean {
  return input.mode === "mock";
}

function simulatedResponse(operationId: string, plate: string) {
  return operationId === "sura-vehicle-by-plate"
    ? { plate, modelo: 2024, fasecolda: "SIM-2024", valorAsegurado: 50000000, valorAccesorios: 0 }
    : { quoteNumber: `SIM-${plate}-${operationId}`, premiumTotal: 1200000, currency: "COP", simulated: true };
}
```

Permit `connection` to be undefined only when `mode === "mock"`; otherwise retain `connectionValues(connection)` and the current provider executor path. Set `connectionOptional: true` only on the `quote` action in `insuranceQuotesExtension`; set `insuranceQuotesConnectorAction.requiresConnection` to `input.mode !== "mock"`. Never forward `mode` to provider templates.

- [ ] **Step 6: Ejecutar las pruebas del paquete y comprobación de tipos.**

Run: `pnpm --filter @savia/insurance-quotes test -- quote-input.test.ts connectors.test.ts && pnpm --filter @savia/insurance-quotes typecheck`

Expected: PASS. Las rutas reales siguen usando `fetcher` simulado; la simulación no lo invoca.

- [ ] **Step 7: Commit del contrato y simulación.**

```bash
git add packages/insurance-quotes/src/screens/quote-input.ts packages/insurance-quotes/test/quote-input.test.ts packages/insurance-quotes/src/connectors.ts packages/insurance-quotes/src/manifest.ts packages/insurance-quotes/test/connectors.test.ts
git commit -m "feat: add simulated insurance quote flow"
```

### Task 3: Implementar el asistente canónico y los resultados actualizables

**Files:**

- Create: `packages/insurance-quotes/src/screens/quote-wizard.tsx`
- Create: `packages/insurance-quotes/src/screens/quote-results.tsx`
- Create: `packages/insurance-quotes/src/screens/quote-screens.css`
- Modify: `packages/insurance-quotes/src/screens/quote-screens.tsx`
- Create: `apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx`

**Interfaces:**

- Consumes: `PluginApi.actions.execute/list`, `InsurancePackageSettings`, catálogo de productos y `quote-input.ts`.
- Produces: `InsuranceQuoteWizard`, `InsuranceQuoteWorkspaceScreen` y `InsuranceQuoteWizardScreen` como dos entradas del mismo flujo.

- [ ] **Step 1: Añadir la prueba de UI que falla para el paso uno y la entrada directa.**

```tsx
it("uses the same three-step wizard from direct and wizard entries", async () => {
  render(<InsuranceQuoteWorkspaceScreen savia={savia} />);
  expect(await screen.findByRole("heading", { name: "Cotizador" })).toBeVisible();
  expect(screen.getByRole("heading", { name: /Paso 1 de 3: Vehículo/ })).toBeVisible();
  expect(screen.getByRole("button", { name: "Siguiente paso" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Actualizar resultados" })).toHaveAccessibleDescription("Actualizar resultados");
});
```

The test fixture must supply `settings.get`, `connections.list`, `actions.list`, and a mocked `actions.execute`. It returns one active simulated product and no real connection. Do not use browser storage in the fixture or implementation.

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla porque el paquete sólo expone dos campos.**

Run: `pnpm --filter @savia/admin test -- insurance-quote-screens.test.tsx`

Expected: FAIL al no encontrar “Paso 1 de 3: Vehículo” ni el botón de resultados.

- [ ] **Step 3: Implementar la carcasa de producción y la navegación accesible.**

```tsx
<main className="insurance-quote" aria-label={entry === "direct" ? "Cotizador" : "Cotizador por pasos"}>
  <header className="insurance-quote__header">
    <div><h1>{entry === "direct" ? "Cotizador" : "Cotizador por pasos"}</h1><p>Cotiza auto liviano en tres pasos.</p></div>
    <div className="insurance-quote__tools"><ExecutionModeControl mode={mode} onChange={setMode} busy={busy} /><TooltipButton label="Actualizar resultados" onClick={() => void refreshRuns()} /></div>
  </header>
  <nav aria-label="Vista del cotizador"><button aria-pressed={surface === "form"} onClick={() => setSurface("form")}>Preparar cotización</button><button aria-pressed={surface === "results"} onClick={() => setSurface("results")}>Resultados{runs.length ? ` (${runs.length})` : ""}</button></nav>
  <nav aria-label="Pasos del formulario"><ol>{quoteSteps.map((step, index) => <li key={step.id} aria-current={index === activeStep ? "step" : undefined}>{step.title}</li>)}</ol></nav>
</main>
```

Render only the active step. Disable Siguiente until `validateQuoteStep` has no errors and present errors adjacent to the affected controls. The third step contains selected-product checkboxes and the **Cotizar** button. Use native `details` for product selection, real `button` elements and concise tooltips; do not paste `request-wizard.css` or import `RequestPage`.

- [ ] **Step 4: Añadir una prueba de consulta y resultados parciales.**

```tsx
it("applies only a matching plate lookup and retains successful products after one failure", async () => {
  actions.execute.mockResolvedValueOnce({ run: { runId: "lookup", status: "succeeded" }, output: { type: "vehicle_lookup", data: { vehicle: { plate: "TESTCAR", productionYear: 2024, currency: "COP" } } } });
  actions.execute.mockResolvedValueOnce({ run: { runId: "ok", status: "succeeded" }, output: { type: "quote", provider: "sbs", data: { quoteNumber: "SIM-1", premiumTotal: 1200000 } } });
  actions.execute.mockRejectedValueOnce(new Error("No se completó el producto"));
  await user.type(screen.getByRole("textbox", { name: "Placa" }), "TESTCAR");
  await user.type(screen.getByRole("textbox", { name: "Código Fasecolda" }), "123");
  await user.type(screen.getByRole("spinbutton", { name: "Año del vehículo" }), "2024");
  await user.type(screen.getByRole("textbox", { name: "Código de ciudad de circulación" }), "11001");
  await user.type(screen.getByRole("spinbutton", { name: "Valor asegurado" }), "50000000");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByRole("textbox", { name: "Número de documento" }), "12345678");
  await user.type(screen.getByRole("textbox", { name: "Nombres" }), "Ana");
  await user.type(screen.getByRole("textbox", { name: "Primer apellido" }), "Pérez");
  await user.type(screen.getByRole("textbox", { name: "Fecha de nacimiento" }), "1990-01-01");
  await user.click(screen.getByRole("button", { name: "Siguiente paso" }));
  await user.type(screen.getByRole("textbox", { name: "Código de ciudad de residencia" }), "11001");
  await user.type(screen.getByRole("textbox", { name: "Dirección" }), "Calle 1 # 2-3");
  await user.type(screen.getByRole("textbox", { name: "Teléfono" }), "3001234567");
  await user.type(screen.getByRole("textbox", { name: "Correo electrónico" }), "ana@example.test");
  await user.click(screen.getByText("Cotizar con"));
  await user.click(screen.getByRole("checkbox", { name: "Autos Gold" }));
  await user.click(screen.getByRole("button", { name: "Cotizar" }));
  await screen.findByText("SIM-1");
  expect(screen.getByRole("alert")).toHaveTextContent("No se completó el producto");
});
```

Use `userEvent` to fill explicit fields rather than mutating component state. Assert the lookup action receives `{ mode: "mock", operationId: "sura-vehicle-by-plate", vehicle: { plate: "TESTCAR" } }`; assert quote actions carry the canonical nested input and each selected product's operation.

- [ ] **Step 5: Implementar ejecución, recarga y resultados.**

```ts
async function refreshRuns() {
  setLoadingRuns(true);
  try { setRuns(await savia.actions.list({ limit: 50 })); }
  catch { setError("No se pudieron actualizar los resultados."); }
  finally { setLoadingRuns(false); }
}

const responses = await Promise.allSettled(selectedProducts.map((product) => savia.actions.execute("quote", {
  ...(mode === "mock" ? {} : { connectionId: product.connectionId }),
  input: { mode, operationId: product.operationId, ...toAutoLightQuoteInput(values) },
})));
```

On lookup, execute with its configured connection in Real and no connection in Simulación. On each fulfilled response merge its `run` with `actions.list()` output; on rejected response add a product-scoped alert without removing prior results. `quote-results.tsx` renders only quote runs and maps `premiumTotal`, `quoteNumber`, `offers`, warnings and a collapsed JSON detail after checking every value's type.

- [ ] **Step 6: Añadir CSS de bajo ruido y comprobar los casos estrechos.**

Use CSS classes scoped under `.insurance-quote`; cap content at 960px, use one-column fields below 640px, give tabs and step markers clear selected states, and preserve `:focus-visible` outlines. Do not use arbitrary inline styles, fixed heights, animation loops or `localStorage`.

- [ ] **Step 7: Ejecutar UI, typecheck y detector de interfaz.**

Run: `pnpm --filter @savia/admin test -- insurance-quote-screens.test.tsx && pnpm --filter @savia/insurance-quotes typecheck && node ~/.codex/skills/impeccable/scripts/detect.mjs --json packages/insurance-quotes/src/screens/quote-wizard.tsx packages/insurance-quotes/src/screens/quote-results.tsx packages/insurance-quotes/src/screens/quote-screens.tsx`

Expected: PASS and detector JSON `[]`. If the detector reports a finding, correct that finding and rerun it once.

- [ ] **Step 8: Commit del asistente.**

```bash
git add packages/insurance-quotes/src/screens/quote-wizard.tsx packages/insurance-quotes/src/screens/quote-results.tsx packages/insurance-quotes/src/screens/quote-screens.css packages/insurance-quotes/src/screens/quote-screens.tsx apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx
git commit -m "feat: restore insurance quote wizard"
```

### Task 4: Completar Administración de Seguros sin revelar credenciales

**Files:**

- Modify: `packages/insurance-quotes/src/screens/quote-screens.tsx`
- Modify: `packages/insurance-quotes/src/configuration.ts`
- Modify: `apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx`

**Interfaces:**

- Consumes: `savia.settings`, `savia.connections`, `providerDefinitions` y el catálogo confiable de productos.
- Produces: controles de visibilidad, orden/asignación de producto, consulta de placa y editor de conexiones sólo para `insurance.quotes.provider`.

- [ ] **Step 1: Añadir pruebas fallidas de asignación y de no re-renderizar secretos.**

```tsx
it("assigns an existing connection to a product and never shows saved secrets", async () => {
  render(<InsurancePackageAdminScreen savia={savia} />);
  await user.selectOptions(screen.getByRole("combobox", { name: "Conexión de Autos Producto 8" }), "sbs-main");
  await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(settings.replace).toHaveBeenCalledWith(expect.objectContaining({ products: [expect.objectContaining({ id: "sbs-product-8", connectionId: "sbs-main" })] }), 4);
  expect(screen.queryByText("tenant-secret")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla por controles ausentes.**

Run: `pnpm --filter @savia/admin test -- insurance-quote-screens.test.tsx`

Expected: FAIL al no encontrar “Conexión de Autos Producto 8” o “Guardar cambios”.

- [ ] **Step 3: Implementar tarjetas de configuración con controles acotados.**

```tsx
const compatible = connections.filter((connection) => connection.connectorId === insuranceQuotesConnectorId);
<label>Conexión de {product.label}<select aria-label={`Conexión de ${product.label}`} value={product.connectionId ?? ""} onChange={(event) => updateProduct(product.id, { connectionId: event.target.value || undefined })}><option value="">Sin conexión</option>{compatible.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>{connection.connectionId}</option>)}</select></label>
```

Render a checkbox for each quote page and product, number inputs for rank, and a dedicated selector for `vehicleLookup.connectionId`. Fetch settings and connection summaries in parallel, save one versioned settings snapshot through `savia.settings.replace`, and show a single conflict alert if a stale update returns 409. Never accept raw action IDs from an input.

- [ ] **Step 4: Implementar el editor de conexión basado en la definición del proveedor.**

```tsx
await savia.connections.replace(connectionId, {
  connectorId: insuranceQuotesConnectorId,
  values: { provider: selectedProvider, credentials: Object.fromEntries(fields.map((field) => [field.name, draft[field.name] ?? ""])) },
});
setDraft({});
setNotice("Conexión guardada. Las credenciales no se muestran de nuevo.");
```

Build the fields from `providerDefinitions`; every credential input is `type="password"` and `autoComplete="new-password"`. After saving, list only the connection summary. A delete action asks `window.confirm("¿Eliminar esta conexión?")` and calls `savia.connections.remove`; it never sends a replacement empty secret object.

- [ ] **Step 5: Ejecutar pruebas de administración y tipo.**

Run: `pnpm --filter @savia/admin test -- insurance-quote-screens.test.tsx && pnpm --filter @savia/insurance-quotes test -- configuration.test.ts && pnpm --filter @savia/insurance-quotes typecheck`

Expected: PASS. Los cambios conservan versiones, productos no configurados y no exponen secretos en DOM ni argumentos de render.

- [ ] **Step 6: Commit de la administración.**

```bash
git add packages/insurance-quotes/src/screens/quote-screens.tsx packages/insurance-quotes/src/configuration.ts apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx
git commit -m "feat: manage insurance quote package"
```

### Task 5: Versionar el paquete, actualizar localmente y verificar la experiencia completa

**Files:**

- Modify: `solutions/insurance/manifest.json`
- Modify: `packages/insurance-quotes/src/manifest.ts`
- Create: `packages/insurance-quotes/test/solution.test.ts`

**Interfaces:**

- Consumes: el manifiesto actual de `savia.insurance` 1.1.0, la extensión existente `insurance.quotes` 1.0.0 y el flujo local de actualización de soluciones ya usado en esta rama.
- Produces: solución 1.2.0 y extensión 1.1.0, actualizables sin borrar configuración, conexiones ni ejecuciones locales.

- [ ] **Step 1: Añadir una prueba de manifiesto que falle con las versiones actuales.**

```ts
it("ships the production-equivalent quote flow as an upgrade", () => {
  expect(insuranceSolution.version).toBe("1.2.0");
  expect(insuranceQuotesExtensionManifest.version).toBe("1.1.0");
});
```

- [ ] **Step 2: Ejecutar la prueba y confirmar que falla por las versiones 1.1.0 y 1.0.0.**

Run: `pnpm --filter @savia/insurance-quotes test -- configuration.test.ts`

Expected: FAIL con la diferencia de versión declarada.

- [ ] **Step 3: Subir versiones sin cambiar IDs ni rutas.**

Set `solutions/insurance/manifest.json` to `"version": "1.2.0"` and `insuranceQuotesExtensionManifest.version` to `"1.1.0"`. Preserve `cotizador`, `cotizador_por_pasos`, `administrar_seguros` and the extension ID `insurance.quotes`; do not create migration data or remove an object.

- [ ] **Step 4: Ejecutar todas las verificaciones automáticas afectadas.**

Run: `pnpm --filter @savia/crm-shared test -- plugin-api.test.ts && pnpm --filter @savia/crm-server test -- extension-connections.test.ts extension-actions.test.ts && pnpm --filter @savia/connector-gateway test -- registry.test.ts && pnpm --filter @savia/insurance-quotes test && pnpm --filter @savia/insurance-quotes typecheck && pnpm --filter @savia/admin test -- insurance-quote-screens.test.tsx && pnpm --filter @savia/admin typecheck`

Expected: PASS. No command is allowed to contain a real provider URL, credential or production host.

- [ ] **Step 5: Actualizar la solución sólo en el runtime local y comprobar visualmente.**

Use the existing local package-update action for `savia.insurance`; do not invoke any remote URL. In `http://127.0.0.1:5173`, verify: (1) `Cotizador` opens step 1 of the shared wizard, (2) all three labels and required fields appear across the steps, (3) Simulación produces a labelled result without a configured connection, (4) Actualizar resultados reloads it, and (5) Administrar Seguros can display connection summaries without credential values. Capture no production traffic.

- [ ] **Step 6: Run the UI detector on all changed package screens.**

Run: `node ~/.codex/skills/impeccable/scripts/detect.mjs --json packages/insurance-quotes/src/screens/quote-wizard.tsx packages/insurance-quotes/src/screens/quote-results.tsx packages/insurance-quotes/src/screens/quote-screens.tsx`

Expected: `[]`. If nonempty, resolve the reported UI issue and rerun the same detector once.

- [ ] **Step 7: Inspect final state and commit the upgrade.**

```bash
git diff --check
git status --short
git add solutions/insurance/manifest.json packages/insurance-quotes/src/manifest.ts packages/insurance-quotes/test/solution.test.ts
git commit -m "chore: release insurance quote wizard"
git status --short
```

Expected: clean worktree after the local commits. Do not push any commit.

## Plan self-review

- Spec coverage: Task 1 covers updated history and safe optional actions; Task 2 covers canonical fields and simulation; Task 3 covers all production-visible wizard behavior and shared entry; Task 4 covers package administration; Task 5 covers local upgrade and verification.
- Placeholder scan: every task has concrete paths, focused commands, test assertions and implementation interfaces; no task defers a decision to an unspecified future change.
- Type consistency: `PluginExtensionActionRun`, `actions.list`, `connectionOptional`, `requiresConnection`, `AutoLightQuoteInput`, `QuoteFormValues` and the `mode` values are defined before their consumers.
