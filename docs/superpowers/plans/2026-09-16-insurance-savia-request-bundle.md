# Bundle de Savia Request para Seguros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Instalar los 18 flows de autos livianos con savia.insurance y ejecutar de forma segura la consulta Sura y las cotizaciones paralelas desde los dos cotizadores.

**Architecture:** Un catálogo tipado define los 18 flows, los 15 productos seleccionables y los dos lookups. Savia Request preserva las definiciones y secretos; un adaptador de conector con allowlist traduce la entrada canónica y llama su endpoint privado. La instalación de Seguros asegura el bundle antes de confirmar la solución en D1.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Hono, React, Zod, Vitest, Testing Library.

**Spec:** docs/superpowers/specs/2026-09-16-insurance-savia-request-bundle-design.md

## Global Constraints

- No ejecutar ni modificar producción; las verificaciones usan workers y D1 locales.
- No incorporar, extraer ni leer certificados PFX; los secretos viven únicamente en variables secretas de Savia Request.
- El adaptador acepta exclusivamente los 18 IDs de 06-Cotizaciones/Autos-livianos/; no acepta una URL, path, cabecera o secreto de la pantalla.
- La instalación restaura la definición canónica y conserva los valores de flow_variables, incluidos secretos.
- Sura es el lookup predeterminado; Equidad queda instalado pero desactivado; Liberty OAuth es interno.
- Los 15 flows de cotización se habilitan y se ejecutan en paralelo; un fallo individual no bloquea el lote.
- No hacer push.

---

## File structure

- packages/insurance-quotes/src/savia-request-bundle.ts — IDs, roles, etiquetas y defaults de los 18 flows.
- packages/insurance-quotes/src/savia-request-input.ts — mapea AutoLightQuoteInput a inputs de texto declarados.
- packages/insurance-quotes/src/savia-request-adapter.ts — allowlist, llamada privada y normalización segura.
- apps/savia-request/src/server/bundles.ts — instalación idempotente desde catalog.json.
- apps/savia-request/migrations/0003_insurance_bundles.sql — versión local del bundle.
- apps/savia-request/src/server/runner.ts — simulaciones deterministas para los 15 quote flows.
- apps/connector-gateway/src/index.ts and apps/connector-gateway/wrangler.jsonc — binding de Savia Request para el adaptador.
- packages/crm-server/src/solutions.ts and API CRM route factories — hook previo de instalación.
- packages/insurance-quotes/src/configuration.ts, manifest.ts, and quote screens — configuración, lote y administración sin credenciales.
- apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx — UI batch coverage.

### Task 1: Declarar bundle, settings y mapeo de entrada

**Files:**
- Create: packages/insurance-quotes/src/savia-request-bundle.ts
- Create: packages/insurance-quotes/src/savia-request-input.ts
- Modify: packages/insurance-quotes/src/configuration.ts:5-123
- Modify: packages/insurance-quotes/src/manifest.ts:13-51
- Create: packages/insurance-quotes/test/savia-request-bundle.test.ts
- Modify: packages/insurance-quotes/test/configuration.test.ts:1-55

**Interfaces:**
- Produces insuranceSaviaRequestBundle, insuranceQuoteFlowCatalog, insuranceLookupFlowCatalog, isInsuranceSaviaRequestFlow(flowId), and toSaviaRequestInput(flowId, quoteInput).
- Produces InsurancePackageSettings = { quotePages; vehicleLookup: { enabled; flowId }; products: Array<{ id; label; enabled; rank }> }.
- toSaviaRequestInput returns Record<string, string>.

- [ ] **Step 1: Write failing catalog and mapper tests**

~~~ts
expect(insuranceSaviaRequestBundle.flows).toHaveLength(18);
expect(insuranceQuoteFlowCatalog).toHaveLength(15);
expect(insuranceLookupFlowCatalog).toEqual([
  expect.objectContaining({ id: "sura-autos-provider", enabledByDefault: true }),
  expect.objectContaining({ id: "equidad-vehicle-by-plate", enabledByDefault: false }),
]);
expect(toSaviaRequestInput("sura-autos-provider", quoteInput)).toEqual({
  sura_test_plate: "TESTCAR",
});
expect(toSaviaRequestInput("sbs-producto-8", quoteInput)).toMatchObject({
  "auto_light.vehicle.plate": "TESTCAR",
  "auto_light.applicant.documentNumber": "12345678",
});
expect(() => toSaviaRequestInput("other-flow", quoteInput)).toThrow(
  "Flow de Seguros no permitido",
);
~~~

- [ ] **Step 2: Run the failing tests**

Run: pnpm exec vitest run test/savia-request-bundle.test.ts test/configuration.test.ts --maxWorkers=1 from packages/insurance-quotes.

Expected: FAIL because the bundle module and settings shape do not exist.

- [ ] **Step 3: Implement the fixed 18-flow descriptor**

~~~ts
export const insuranceSaviaRequestBundle = {
  id: "insurance-auto-light",
  version: "1.0.0",
  flows: [
    { id: "sbs-producto-8", role: "quote", label: "SBS · Autos Producto 8" },
    { id: "sbs-producto-10", role: "quote", label: "SBS · Gold" },
    { id: "sbs-producto-11", role: "quote", label: "SBS · Plata" },
    { id: "equidad-basico-quote", role: "quote", label: "Equidad · Básico" },
    { id: "equidad-full-quote", role: "quote", label: "Equidad · Full" },
    { id: "equidad-ligero-quote", role: "quote", label: "Equidad · Ligero" },
    { id: "equidad-rce-quote", role: "quote", label: "Equidad · RCE" },
    { id: "liberty-basico-quote", role: "quote", label: "Liberty · Básico" },
    { id: "liberty-basico-pt-quote", role: "quote", label: "Liberty · Básico + PT" },
    { id: "liberty-full-quote", role: "quote", label: "Liberty · Full" },
    { id: "liberty-integral-quote", role: "quote", label: "Liberty · Integral" },
    { id: "mapfre-para-la-mujer-quote", role: "quote", label: "Mapfre · Para la Mujer" },
    { id: "qualitas-direct-research", role: "quote", label: "Qualitas · Amplia" },
    { id: "qualitas-base-quote", role: "quote", label: "Qualitas · Base" },
    { id: "qualitas-plus-quote", role: "quote", label: "Qualitas · Plus" },
    { id: "sura-autos-provider", role: "lookup", label: "Sura", enabledByDefault: true },
    { id: "equidad-vehicle-by-plate", role: "lookup", label: "Equidad", enabledByDefault: false },
    { id: "liberty-get-oauth-token", role: "internal", label: "Liberty OAuth" },
  ],
} as const;

export function isInsuranceSaviaRequestFlow(flowId: string) {
  return insuranceSaviaRequestBundle.flows.some((flow) => flow.id === flowId);
}
~~~

Derive the 15 selectable products and lookup choices from this descriptor. For SBS map the existing form to all declared auto_light.* inputs; Sura maps only sura_test_plate, Equidad only equidad_v2_test_plate. For the other quote flows return an empty input object: their complete request body is supplied as a configuration variable in Savia Request, never built from browser fields.

- [ ] **Step 4: Make old settings readable and remove connection requirements**

~~~ts
vehicleLookup: {
  enabled: stored.vehicleLookup.enabled,
  flowId: stored.vehicleLookup.flowId ?? "sura-autos-provider",
},
products: insuranceQuoteProductCatalog.map((product, index) => ({
  id: product.id,
  label: product.label,
  enabled: configured.get(product.id)?.enabled ?? true,
  rank: configured.get(product.id)?.rank ?? (index + 1) * 10,
})),
~~~

Parse legacy connectionId fields only to discard them. Do not emit them in merged settings. Set the extension action connectionOptional: true and bump its manifest version.

- [ ] **Step 5: Verify and commit**

Run: pnpm exec vitest run test/savia-request-bundle.test.ts test/configuration.test.ts --maxWorkers=1 && pnpm exec tsc --noEmit from packages/insurance-quotes.

Expected: PASS.

~~~bash
git add packages/insurance-quotes/src/savia-request-bundle.ts packages/insurance-quotes/src/savia-request-input.ts packages/insurance-quotes/src/configuration.ts packages/insurance-quotes/src/manifest.ts packages/insurance-quotes/test/savia-request-bundle.test.ts packages/insurance-quotes/test/configuration.test.ts
git commit -m "feat: declare insurance Savia Request bundle"
~~~

### Task 2: Instalar el bundle y simular los 15 proveedores localmente

**Files:**
- Create: apps/savia-request/src/server/bundles.ts
- Create: apps/savia-request/migrations/0003_insurance_bundles.sql
- Modify: apps/savia-request/src/server/store.ts:1-51
- Modify: apps/savia-request/src/server/index.ts:1-105
- Modify: apps/savia-request/src/server/runner.ts:24-90
- Create: apps/savia-request/src/server/bundles.test.ts
- Create: apps/savia-request/src/server/runner.test.ts

**Interfaces:**
- Produces ensureInsuranceAutoLightBundle(env): Promise<{ id: "insurance-auto-light"; version: "1.0.0"; flowIds: string[] }>.
- Adds private POST /api/bundles/insurance-auto-light/ensure.
- Mock results include a deterministic quote number and premium for every auto-light quote flow.

- [ ] **Step 1: Write failing installer tests**

~~~ts
await ensureInsuranceAutoLightBundle(env);
expect(await getFlow(env, "sura-autos-provider")).toMatchObject({
  id: "sura-autos-provider",
  kind: "lookup",
});
expect(await variableValue(env, "sura-autos-provider", "sura_api_key"))
  .toBe(sealedExistingSecret);
expect(await bundleVersion(env, "insurance-auto-light")).toBe("1.0.0");
expect(await countAutoLightFlows(env)).toBe(18);
~~~

Test the private ensure endpoint twice and assert no duplicated variables.

- [ ] **Step 2: Run the failing worker tests**

Run: pnpm exec vitest run src/server/bundles.test.ts src/server/runner.test.ts --maxWorkers=1 from apps/savia-request.

Expected: FAIL because the installer and table do not exist.

- [ ] **Step 3: Implement idempotent ensure without updating variables**

~~~sql
CREATE TABLE IF NOT EXISTS installed_bundles (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  installed_at TEXT NOT NULL
);
~~~

~~~ts
const flows = (catalog as Flow[]).filter((flow) =>
  flow.steps[0]?.sourcePath?.startsWith("06-Cotizaciones/Autos-livianos/"),
);
const variablesFor = (flow: Flow) => [
  ...flow.variables,
  ...Object.keys(flow.input)
    .filter((key) => key.endsWith("_request_body"))
    .filter((key) => !flow.variables.some((variable) => variable.key === key))
    .map((key) => ({ key, value: "", secret: false })),
];
await env.DB.batch(flows.flatMap((flow) => [
  env.DB.prepare("INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition")
    .bind(flow.id, JSON.stringify({ ...flow, variables: [] })),
  ...variablesFor(flow).map((variable) =>
    env.DB.prepare("INSERT OR IGNORE INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)")
      .bind(flow.id, variable.key, variable.value, variable.secret ? 1 : 0)),
]));
~~~

Record insurance-auto-light@1.0.0 after the inserts. The request-body variables are editable in Savia Request, but their values remain intact during a later ensure. The endpoint must have no request parameters and only invokes this function. Keep seedOnce unchanged.

- [ ] **Step 4: Make mock bypass provider-only configuration**

For mock non-SBS quote flows, skip provider pre/post hooks and missing-variable checks, use https://mock.invalid as the destination, and return:

~~~ts
{
  quoteNumber: "SIM-" + flow.id.toUpperCase(),
  premiumTotal: 1200000 + index * 10000,
  currency: "COP",
  simulated: true,
}
~~~

Continue using the current SBS simulator and Sura mock lookup. Keep all live hook execution, validation, timeouts, origin validation, and redaction unchanged.

- [ ] **Step 5: Verify and commit**

Run: pnpm exec vitest run src/server/bundles.test.ts src/server/runner.test.ts --maxWorkers=1 && pnpm exec tsc --noEmit from apps/savia-request.

Expected: PASS; all 15 quote flows work in mock and the stored secret is unchanged.

~~~bash
git add apps/savia-request/migrations/0003_insurance_bundles.sql apps/savia-request/src/server/bundles.ts apps/savia-request/src/server/store.ts apps/savia-request/src/server/index.ts apps/savia-request/src/server/runner.ts apps/savia-request/src/server/bundles.test.ts apps/savia-request/src/server/runner.test.ts
git commit -m "feat: install insurance request bundle"
~~~

### Task 3: Reemplazar el conector directo por un adaptador allowlisted

**Files:**
- Create: packages/insurance-quotes/src/savia-request-adapter.ts
- Create: packages/insurance-quotes/test/savia-request-adapter.test.ts
- Modify: packages/insurance-quotes/src/normalize.ts:106-121
- Modify: apps/connector-gateway/src/index.ts:1-29
- Modify: apps/connector-gateway/wrangler.jsonc
- Modify: packages/release-catalog/src/runtime.ts:12-61
- Create: apps/connector-gateway/test/insurance-savia-request-action.test.ts

**Interfaces:**
- Produces createInsuranceSaviaRequestConnectorAction(service).
- Action input is { mode: "mock" | "live"; flowId: string; quoteInput: AutoLightQuoteInput }.
- The adapter calls only https://savia-request.internal/api/flows/:flowId/runs.

- [ ] **Step 1: Write failing safety tests**

~~~ts
await expect(adapter.execute({ context, connection: {}, input: {
  mode: "mock", flowId: "sura-autos-provider", quoteInput,
} })).resolves.toMatchObject({
  type: "vehicle_lookup",
  data: { vehicle: { plate: "TESTCAR" } },
});
await expect(adapter.execute({ context, connection: {}, input: {
  mode: "mock", flowId: "https://evil.invalid", quoteInput,
} })).rejects.toThrow("Flow de Seguros no permitido");
expect(JSON.stringify(result)).not.toContain("apiKey");
~~~

Assert the service request URL is the declared private flow URL and body contains no arbitrary headers, URL or secrets.

- [ ] **Step 2: Run tests to verify they fail**

Run: pnpm exec vitest run test/savia-request-adapter.test.ts --maxWorkers=1 from packages/insurance-quotes.

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement strict input, private request, and safe failures**

~~~ts
if (!isInsuranceSaviaRequestFlow(request.flowId))
  throw new Error("Flow de Seguros no permitido");
const response = await service.fetch(new Request(
  "https://savia-request.internal/api/flows/" + request.flowId + "/runs",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: request.mode,
      input: toSaviaRequestInput(request.flowId, request.quoteInput),
    }),
  },
));
~~~

Use a strict Zod schema. A failed flow returns a sanitized insurance output with status: "error" and an error code; it never forwards the raw upstream message. Extend lookup normalization so sura-autos-provider produces the existing vehicle shape. Do not use ProviderExecutor, browser fetch, provider connections, or public Request Results routes.

- [ ] **Step 4: Bind the adapter only in the connector worker**

~~~ts
type ConnectorEnvironment = {
  DB: D1Database;
  EXTENSION_CONNECTIONS_ENCRYPTION_KEY?: string;
  SAVIA_REQUEST?: { fetch(request: Request): Promise<Response> };
};

actions: [
  ...runtimeReleaseCatalog.connectorActions.filter(
    (action) => action.extensionId !== insuranceQuotesExtensionId,
  ),
  createInsuranceSaviaRequestConnectorAction(environment.SAVIA_REQUEST),
],
~~~

Add the SAVIA_REQUEST service binding to the connector gateway Wrangler config and remove the old direct insurance action contribution from the runtime catalog.

- [ ] **Step 5: Verify and commit**

Run package: pnpm exec vitest run test/savia-request-adapter.test.ts --maxWorkers=1 && pnpm exec tsc --noEmit.

Run gateway: pnpm exec vitest run test/insurance-savia-request-action.test.ts --maxWorkers=1 && pnpm exec tsc --noEmit.

Expected: PASS; only declared IDs run and no secret reaches output.

~~~bash
git add packages/insurance-quotes/src/savia-request-adapter.ts packages/insurance-quotes/src/normalize.ts packages/insurance-quotes/test/savia-request-adapter.test.ts apps/connector-gateway/src/index.ts apps/connector-gateway/wrangler.jsonc apps/connector-gateway/test/insurance-savia-request-action.test.ts packages/release-catalog/src/runtime.ts
git commit -m "feat: route insurance actions through Savia Request"
~~~

### Task 4: Asegurar el bundle durante la instalación de Seguros

**Files:**
- Modify: packages/crm-server/src/solutions.ts:15-18,185-327
- Modify: packages/crm-server/test/solutions.test.ts
- Create: apps/api/src/solutions/insurance-bundle-installer.ts
- Create: apps/api/src/solutions/insurance-bundle-installer.test.ts
- Modify: apps/api/src/crm/collection-gateway.ts:25-88
- Modify: apps/api/src/routes/dynamic-crm.ts:11-154
- Modify: apps/api/src/routes/data-domains.ts:90-235
- Modify: apps/api/src/app.ts:96-131

**Interfaces:**
- Adds SolutionOptions.beforeInstall(input: { tenantId: string; manifest: SolutionPackage }): Promise<void>.
- Produces ensureInsuranceBundle(service, manifest), which calls the fixed ensure endpoint only for savia.insurance.

- [ ] **Step 1: Write failing installation hook tests**

~~~ts
const beforeInstall = vi.fn();
await installSolution(db, "tenant-a", insuranceSolution, { beforeInstall });
expect(beforeInstall).toHaveBeenCalledWith({
  tenantId: "tenant-a",
  manifest: expect.objectContaining({ id: "savia.insurance" }),
});
await expect(installSolution(db, "tenant-b", insuranceSolution, {
  beforeInstall: async () => { throw new Error("bundle unavailable"); },
})).rejects.toThrow("bundle unavailable");
expect(await installedSolution(db, "tenant-b", "savia.insurance")).toBeNull();
~~~

For API, assert only this request is sent: POST https://savia-request.internal/api/bundles/insurance-auto-light/ensure; another solution sends no request.

- [ ] **Step 2: Run failing tests**

Run: pnpm exec vitest run test/solutions.test.ts --maxWorkers=1 from packages/crm-server.

Run: pnpm exec vitest run src/solutions/insurance-bundle-installer.test.ts --maxWorkers=1 from apps/api.

Expected: FAIL because the hook and installer are absent.

- [ ] **Step 3: Call the hook before the local D1 transaction**

~~~ts
export type SolutionOptions = {
  solutionCatalog?: readonly unknown[];
  extensionRegistry?: ExtensionRegistry;
  beforeInstall?: (input: {
    tenantId: string;
    manifest: SolutionPackage;
  }) => Promise<void>;
};

if (installed?.version !== manifest.version)
  await options.beforeInstall?.({ tenantId: tenant, manifest });
~~~

Place this after preview.canInstall and before building D1 statements. Same-version install stays a no-op.

- [ ] **Step 4: Thread the service only to beforeInstall**

~~~ts
export async function ensureInsuranceBundle(service, manifest) {
  if (manifest.id !== "savia.insurance") return;
  if (!service) throw new Error("Savia Request no está disponible.");
  const response = await service.fetch(new Request(
    "https://savia-request.internal/api/bundles/insurance-auto-light/ensure",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  ));
  if (!response.ok) throw new Error("No se pudo preparar el paquete de Seguros.");
}
~~~

Pass the callback through both dynamic CRM and data-domain route factory calls. Do not add a public API route and do not expose the service to plugin screens.

- [ ] **Step 5: Verify and commit**

Run CRM server: pnpm exec vitest run test/solutions.test.ts --maxWorkers=1 && pnpm exec tsc --noEmit.

Run API: pnpm exec vitest run src/solutions/insurance-bundle-installer.test.ts --maxWorkers=1 && pnpm exec tsc --noEmit.

Expected: PASS; a failed ensure leaves the solution uninstalled.

~~~bash
git add packages/crm-server/src/solutions.ts packages/crm-server/test/solutions.test.ts apps/api/src/crm/collection-gateway.ts apps/api/src/routes/dynamic-crm.ts apps/api/src/routes/data-domains.ts apps/api/src/app.ts apps/api/src/solutions/insurance-bundle-installer.ts apps/api/src/solutions/insurance-bundle-installer.test.ts
git commit -m "feat: prepare request bundle during insurance install"
~~~

### Task 5: Ejecutar el lote, preseleccionar comparación y reducir el panel admin

**Files:**
- Modify: packages/insurance-quotes/src/screens/quote-wizard.tsx:1-402
- Modify: packages/insurance-quotes/src/screens/quote-results.tsx:1-294
- Modify: packages/insurance-quotes/src/screens/quote-screens.tsx:1-543
- Modify: packages/insurance-quotes/src/screens/quote-screens.css:1-112
- Modify: apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx:11-260

**Interfaces:**
- Wizard action call: savia.actions.execute("quote", { input: { mode, flowId, quoteInput } }).
- QuoteResults adds preferredRunIds?: readonly string[] and defaults comparison to the first four current-batch IDs.

- [ ] **Step 1: Write failing batch UI tests**

~~~tsx
expect(screen.getByText("15 productos")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Consultar placa" }));
expect(actions.execute).toHaveBeenCalledWith("quote", {
  input: expect.objectContaining({ mode: "mock", flowId: "sura-autos-provider" }),
});
await user.click(screen.getByRole("button", { name: "Cotizar" }));
expect(actions.execute).toHaveBeenCalledTimes(16); // lookup plus fifteen products
expect(await screen.findByText("4 de 4 seleccionados para comparar")).toBeVisible();
~~~

Return distinct action runs for 15 products and reject one. Assert provider labels remain clear, a safe failure appears after refresh, and historic runs are not prechecked.

- [ ] **Step 2: Run the failing screen test**

Run: pnpm exec vitest run src/features/crm-engine/test/insurance-quote-screens.test.tsx --maxWorkers=1 from apps/admin.

Expected: FAIL because only one product is selected and operationId uses direct-provider execution.

- [ ] **Step 3: Use the bundle contract and keep Promise.allSettled**

~~~tsx
useEffect(() => {
  setSelectedProducts((current) => {
    const available = products.map((product) => product.id);
    const retained = current.filter((id) => available.includes(id));
    return retained.length ? retained : available;
  });
}, [products]);

const responses = await Promise.allSettled(selected.map((product) =>
  savia.actions.execute("quote", {
    input: {
      mode,
      flowId: product.flowId,
      quoteInput: toAutoLightQuoteInput(values),
    },
  }),
));
~~~

Lookup uses the configured vehicleLookup.flowId and no connection ID. After completion, pass completed run IDs to results. Read known flow IDs from output when titling cards. Render output.status === "error" as a failed card with its safe code.

- [ ] **Step 4: Remove credential administration and keep concise controls**

Delete connection listing, creation, provider selector, removal and credential inputs from InsurancePackageAdminScreen. Keep screen visibility, compact enabled/order controls for 15 products, and lookup toggle/select. Use exactly these tooltip texts on small help controls:

~~~tsx
title="Las credenciales se administran en Savia Request; este paquete solo decide qué flows se ejecutan."
title="Sura está disponible por defecto. Equidad requiere una configuración válida antes de habilitarse."
title="Los productos habilitados se ejecutan juntos; puedes cambiar el orden visual de la comparación."
~~~

Remove only connection-only CSS selectors; retain existing responsive and focus styles.

- [ ] **Step 5: Verify UI and commit**

Run: pnpm exec vitest run src/features/crm-engine/test/insurance-quote-screens.test.tsx --maxWorkers=1 && pnpm exec tsc --noEmit from apps/admin.

Then inspect mock mode in the in-app browser and run:

~~~bash
node ~/.codex/skills/impeccable/scripts/detect.mjs --json packages/insurance-quotes/src/screens/quote-wizard.tsx packages/insurance-quotes/src/screens/quote-results.tsx packages/insurance-quotes/src/screens/quote-screens.tsx packages/insurance-quotes/src/screens/quote-screens.css
~~~

Expected: PASS, detector [], and a batch visibly displays multiple cards.

~~~bash
git add packages/insurance-quotes/src/screens/quote-wizard.tsx packages/insurance-quotes/src/screens/quote-results.tsx packages/insurance-quotes/src/screens/quote-screens.tsx packages/insurance-quotes/src/screens/quote-screens.css apps/admin/src/features/crm-engine/test/insurance-quote-screens.test.tsx
git commit -m "feat: compare insurance request bundle quotes"
~~~

### Task 6: Publicar localmente la nueva versión y hacer smoke test

**Files:**
- Modify: solutions/insurance/manifest.json:1-405
- Modify: packages/insurance-quotes/test/solution.test.ts:1-11

**Interfaces:**
- Solution version advances to 1.3.0; extension manifest version advances to 1.2.0.

- [ ] **Step 1: Write the failing release assertion**

~~~ts
expect(insuranceSolution.version).toBe("1.3.0");
expect(insuranceQuotesExtensionManifest.version).toBe("1.2.0");
~~~

- [ ] **Step 2: Run the failing release test**

Run: pnpm exec vitest run test/solution.test.ts --maxWorkers=1 from packages/insurance-quotes.

Expected: FAIL with version 1.2.0 / 1.1.0.

- [ ] **Step 3: Bump versions and verify persisted local installation**

After updating only those two versions, install/update local savia.insurance, then run:

~~~bash
pnpm --filter @savia/api exec wrangler d1 execute savia-agencies --local --config wrangler.jsonc --command "SELECT id,version FROM crm_solution_installations WHERE tenant_id='domain:platform' AND id='savia.insurance'"
pnpm --filter @savia/request exec wrangler d1 execute flow-lab-local --local --config wrangler.jsonc --command "SELECT id,version FROM installed_bundles WHERE id='insurance-auto-light'"
pnpm --filter @savia/request exec wrangler d1 execute flow-lab-local --local --config wrangler.jsonc --command "SELECT count(*) AS total FROM flows WHERE json_extract(definition,'$.folderPath') LIKE '06-Cotizaciones/Autos-livianos/%'"
~~~

Expected: solution 1.3.0, bundle 1.0.0, and exactly 18 flows.

- [ ] **Step 4: Run local browser smoke test**

In Cotizador, use Simulación, enter the three steps, click Consultar placa, confirm vehicle values populate, then click Cotizar. Confirm several cards and four automatic comparison checks. Do not switch to Real.

- [ ] **Step 5: Run final verification and commit without push**

Run package tests from packages/insurance-quotes:

~~~bash
pnpm exec vitest run test/savia-request-bundle.test.ts test/savia-request-adapter.test.ts test/configuration.test.ts test/solution.test.ts --maxWorkers=1
pnpm exec tsc --noEmit
~~~

Run Task 2 and Task 4 tests in their owning apps, then the focused Admin UI test. All commands must exit 0.

~~~bash
git add solutions/insurance/manifest.json packages/insurance-quotes/test/solution.test.ts
git commit -m "feat: release insurance request bundle"
git status --short
git log --oneline -6
~~~

Expected: only local commits; never run git push.
