import { databaseConflict, databaseInputFailure } from "@savia/db/errors";
import { HTTPException } from "hono/http-exception";
import { lookupDaneCity } from "./dane";
import { openApi } from "./openapi";
import { Hono } from "hono";
import type { Env } from "./env";
import type { Flow, Variable } from "./types";
import {
  bundleStatus,
  createFolder,
  deleteFlow,
  deleteFolder,
  duplicateFlow,
  ensureInsuranceAutoLightBundle,
  folderExists,
  getFlow,
  getRun,
  getVariables,
  getVersionDefinition,
  importVariables,
  listAuditEvents,
  listFolders,
  listRuns,
  listScopedFlows,
  listVersions,
  publishFlow,
  purgeTenant,
  recordAudit,
  resetFlow,
  resetVariable,
  resolveVersion,
  saveFlow,
  saveVariables,
  seedOnce,
  syncInsuranceAutoLightBundle,
} from "./store";
import { isPlatformTenant, scopeTenant } from "./tenant";
import { execute } from "./runner";
import { demoInput } from "./mock";
const app = new Hono<{ Bindings: Env }>();
function scopeOf(request: Request): string {
  const header = request.headers.get("x-savia-tenant");
  if (header !== null) return scopeTenant(header);
  try {
    return scopeTenant(new URL(request.url).searchParams.get("tenant"));
  } catch {
    return scopeTenant("");
  }
}
/** Principal id forwarded by the API gateway for attribution, if any. */
function actorOf(request: Request): string {
  return (request.headers.get("x-savia-actor") ?? "").slice(0, 200);
}
app.use("*", async (c, next) => {
  if (new URL(c.req.url).hostname !== "savia-request.internal")
    return c.json({ error: "Acceso privado." }, 403);
  if (
    ["POST", "PUT", "DELETE"].includes(c.req.method) &&
    !c.req.header("content-type")?.startsWith("application/json")
  )
    return c.json({ error: "Usa application/json." }, 415);
  try {
    scopeOf(c.req.raw);
  } catch {
    return c.json({ error: "Tenant inválido." }, 400);
  }
  c.header("Cache-Control", "no-store");
  await next();
});
app.get("/api/lookups/dane", async (c) => {
  const city = c.req.query("city") ?? "";
  const department = c.req.query("department");
  if (
    city.trim().length < 2 ||
    city.length > 100 ||
    (department?.length ?? 0) > 100
  )
    return c.json({ error: "Indica una ciudad válida." }, 400);
  try {
    return c.json(
      await lookupDaneCity(
        c.req.query("city") ?? "",
        c.req.query("department"),
      ),
    );
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "No se pudo consultar DANE.",
      },
      502,
    );
  }
});
app.get("/api/health", (c) => c.json({ ok: true, local: true }));
app.post("/api/bundles/insurance-auto-light/ensure", async (c) => {
  const scope = scopeOf(c.req.raw);
  const installed = await ensureInsuranceAutoLightBundle(c.env, scope);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "bundle.ensure",
    detail: { bundle: installed.id, version: installed.version },
  });
  return c.json(installed);
});
app.get("/api/bundles/insurance-auto-light/status", async (c) =>
  c.json(await bundleStatus(c.env, scopeOf(c.req.raw))),
);
app.post("/api/bundles/insurance-auto-light/sync", async (c) => {
  const scope = scopeOf(c.req.raw);
  const body = await c.req.json().catch(() => ({}));
  const flowIds = body?.flowIds;
  const force = body?.force;
  if (
    (flowIds !== undefined &&
      (!Array.isArray(flowIds) ||
        flowIds.length > 200 ||
        flowIds.some(
          (id: unknown) => typeof id !== "string" || !id || id.length > 120,
        ))) ||
    (force !== undefined && typeof force !== "boolean")
  )
    return c.json({ error: "Parámetros de sincronización inválidos." }, 400);
  const result = await syncInsuranceAutoLightBundle(c.env, scope, {
    ...(flowIds === undefined ? {} : { flowIds }),
    ...(force === undefined ? {} : { force }),
  });
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "bundle.sync",
    detail: {
      version: result.version,
      updated: result.updated.length,
      installed: result.installed.length,
      skipped: result.skippedCustomized.length,
    },
  });
  return c.json(result);
});
/**
 * Tenant lifecycle: removes every overlay row (flows, variables including
 * sealed secrets, versions, runs, folders, bundle markers) so a deleted
 * tenant leaves nothing behind. The platform catalog ("") is refused.
 * Reachable by platform admins through the API proxy; a scoped caller may
 * only purge its own scope.
 */
app.delete("/api/admin/tenants/:tenant", async (c) => {
  let scope: string;
  try {
    scope = scopeTenant(c.req.param("tenant"));
  } catch {
    return c.json({ error: "Tenant inválido." }, 400);
  }
  if (!scope) return c.json({ error: "Tenant inválido." }, 400);
  const caller = scopeOf(c.req.raw);
  if (caller && caller !== scope)
    return c.json({ error: "Acceso privado." }, 403);
  try {
    const purged = await purgeTenant(c.env, scope);
    await recordAudit(c.env, {
      tenant: scope,
      actor: actorOf(c.req.raw),
      action: "tenant.purge",
      detail: { purged },
    });
    return c.json({ tenant: scope, purged });
  } catch {
    return c.json(
      { error: "El catálogo de plataforma no se puede purgar." },
      400,
    );
  }
});
app.get("/api/flows", async (c) => {
  const scope = scopeOf(c.req.raw);
  await seedOnce(c.env);
  const flows = await listScopedFlows(c.env, scope);
  return c.json(
    flows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      folderPath: flow.folderPath,
      customized: flow.customized ?? false,
      steps: flow.steps.map((s) => ({
        id: s.id,
        name: s.name,
        method: s.method,
      })),
    })),
  );
});
app.get("/api/folders", async (c) => {
  return c.json(await listFolders(c.env, scopeOf(c.req.raw)));
});
app.post("/api/folders", async (c) => {
  const scope = scopeOf(c.req.raw);
  const { path } = await c.req.json();
  if (typeof path !== "string")
    return c.json({ error: "Nombre de carpeta inválido." }, 400);
  const parts = path.split("/").map((part) => part.trim());
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part.includes("\\"),
    )
  )
    return c.json(
      { error: "Escribe un nombre válido para cada carpeta." },
      400,
    );
  const normalized = parts.join("/");
  if (await folderExists(c.env, normalized, scope))
    return c.json({ error: "Ya existe una carpeta en esa ubicación." }, 409);
  await createFolder(c.env, normalized, scope);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "folder.create",
    detail: { path: normalized },
  });
  return c.json({ path: normalized }, 201);
});
app.delete("/api/folders", async (c) => {
  const scope = scopeOf(c.req.raw);
  const { path } = await c.req.json();
  if (typeof path !== "string" || !path.trim())
    return c.json({ error: "Carpeta inválida." }, 400);
  for (const flow of await listScopedFlows(c.env, scope)) {
    if (flow?.folderPath === path || flow?.folderPath?.startsWith(path + "/"))
      return c.json(
        {
          error:
            "La carpeta contiene requests. Muévelos a otra carpeta antes de eliminarla.",
        },
        409,
      );
  }
  await deleteFolder(c.env, path, scope);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "folder.delete",
    detail: { path },
  });
  return c.json({ ok: true });
});
app.post("/api/flows/:id/duplicate", async (c) => {
  const scope = scopeOf(c.req.raw);
  const duplicated = await duplicateFlow(c.env, c.req.param("id"), scope);
  if (!duplicated) return c.json({ error: "Request no encontrado." }, 404);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "flow.duplicate",
    flowId: duplicated.id,
    detail: { source: c.req.param("id") },
  });
  return c.json(duplicated, 201);
});
app.delete("/api/flows/:id", async (c) => {
  const scope = scopeOf(c.req.raw);
  const id = c.req.param("id");
  if (!(await deleteFlow(c.env, id, scope)))
    return c.json({ error: "Request no encontrado." }, 404);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "flow.delete",
    flowId: id,
  });
  return c.json({ ok: true });
});
app.post("/api/flows/:id/variables/reveal", async (c) => {
  const scope = scopeOf(c.req.raw);
  const { key } = await c.req.json();
  const rows = await getVariables(c.env, c.req.param("id"), true, scope);
  const variable = rows.find((v) => v.key === key);
  if (!variable) return c.json({ error: "Variable no encontrada." }, 404);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "variable.reveal",
    flowId: c.req.param("id"),
    detail: { key },
  });
  return c.json({ value: variable.value });
});
app.get("/api/demo-input", (c) => c.json(demoInput));
app.get("/api/flows/:id", async (c) => {
  const scope = scopeOf(c.req.raw);
  const flow = await getFlow(c.env, c.req.param("id"), scope);
  if (!flow) return c.json({ error: "Flow no encontrado." }, 404);
  return c.json({
    ...flow,
    variables: await getVariables(c.env, flow.id, false, scope),
    versions: await listVersions(c.env, flow.id, scope),
  });
});
function validateFlow(value: Flow) {
  if (
    !value ||
    !/^[a-z0-9-]{1,80}$/.test(value.id) ||
    !value.name ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    !value.input ||
    typeof value.input !== "object"
  )
    throw new Error("Flow inválido");
  for (const step of value.steps) {
    if (
      !step.id ||
      !step.name ||
      typeof step.body !== "string" ||
      typeof step.pre !== "string" ||
      typeof step.post !== "string" ||
      !step.headers ||
      Object.values(step.headers).some((v) => typeof v !== "string")
    )
      throw new Error("Paso inválido");
  }
}
app.put("/api/flows/:id", async (c) => {
  const scope = scopeOf(c.req.raw);
  const flow = await c.req.json<Flow>();
  flow.id = c.req.param("id");
  validateFlow(flow);
  await saveFlow(c.env, flow, scope);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "flow.save",
    flowId: flow.id,
    detail: {
      name: flow.name,
      hosts: [
        ...new Set(
          flow.steps.map((step) => {
            try {
              return new URL(step.url).host;
            } catch {
              return "template";
            }
          }),
        ),
      ],
    },
  });
  return c.json({ ok: true });
});
app.put("/api/flows/:id/variables", async (c) => {
  const scope = scopeOf(c.req.raw);
  const rows = await c.req.json<Variable[]>();
  if (
    !Array.isArray(rows) ||
    rows.length > 150 ||
    rows.some(
      (v) =>
        !v ||
        !/^[\w.-]{1,120}$/.test(v.key) ||
        typeof v.value !== "string" ||
        typeof v.secret !== "boolean",
    ) ||
    new Set(rows.map((v) => v.key)).size !== rows.length
  )
    return c.json({ error: "Variables inválidas o claves duplicadas." }, 400);
  const flow = await getFlow(c.env, c.req.param("id"), scope);
  if (!flow) return c.json({ error: "Flow no encontrado." }, 404);
  await saveVariables(c.env, flow.id, rows, scope);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "variables.save",
    flowId: flow.id,
    detail: { keys: rows.length },
  });
  return c.json({ ok: true });
});
/**
 * Reverts one tenant customization back to the platform catalog.
 * Flow reset removes its definition and variable overlays (tenant-only
 * flows disappear; versions and runs are kept as history). Variable reset
 * removes a single override so the platform default applies again.
 */
app.post("/api/flows/:id/reset", async (c) => {
  const scope = scopeOf(c.req.raw);
  if (isPlatformTenant(scope))
    return c.json(
      { error: "El restablecido solo aplica a scopes de tenant." },
      400,
    );
  const status = await resetFlow(c.env, c.req.param("id"), scope);
  if (status === "unknown-flow")
    return c.json({ error: "Flow no encontrado." }, 404);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "flow.reset",
    flowId: c.req.param("id"),
    detail: { reverted: status === "reverted" },
  });
  return c.json({ ok: true, reverted: status === "reverted" });
});
app.delete("/api/flows/:id/variables/:key", async (c) => {
  const scope = scopeOf(c.req.raw);
  if (isPlatformTenant(scope))
    return c.json(
      { error: "El restablecido solo aplica a scopes de tenant." },
      400,
    );
  const status = await resetVariable(
    c.env,
    c.req.param("id"),
    c.req.param("key"),
    scope,
  );
  if (status === "unknown-flow")
    return c.json({ error: "Flow no encontrado." }, 404);
  if (status === "unknown-key")
    return c.json({ error: "Variable no encontrada." }, 404);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "variable.reset",
    flowId: c.req.param("id"),
    detail: { key: c.req.param("key"), reverted: status === "reverted" },
  });
  return c.json({ ok: true, reverted: status === "reverted" });
});
/** Single-request bulk transfer so moving secrets between environments is fast. */
app.get("/api/variables/export", async (c) => {
  const scope = scopeOf(c.req.raw);
  await seedOnce(c.env);
  const flows = [];
  for (const flow of await listScopedFlows(c.env, scope)) {
    const variables = await getVariables(c.env, flow.id, true, scope);
    if (variables.length)
      flows.push({
        flowId: flow.id,
        variables: variables
          .map((variable) => ({
            key: variable.key,
            value: variable.value,
            secret: variable.secret,
          }))
          .sort((left, right) => left.key.localeCompare(right.key)),
      });
  }
  return c.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    tenant: scope,
    flows,
  });
});
app.post("/api/variables/import", async (c) => {
  const scope = scopeOf(c.req.raw);
  const body = await c.req.json();
  const incoming = Array.isArray(body) ? body : body?.flows;
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > 200)
    return c.json({ error: "Archivo de secretos inválido." }, 400);
  const seen = new Set<string>();
  const parsed: { flowId: string; variables: Variable[] }[] = [];
  for (const flow of incoming) {
    if (
      !flow ||
      typeof flow.flowId !== "string" ||
      !flow.flowId ||
      seen.has(flow.flowId) ||
      !Array.isArray(flow.variables) ||
      flow.variables.length > 150
    )
      return c.json({ error: "Archivo de secretos inválido." }, 400);
    seen.add(flow.flowId);
    const variables: Variable[] = [];
    for (const variable of flow.variables) {
      if (
        !variable ||
        !/^[\w.-]{1,120}$/.test(variable.key) ||
        typeof variable.value !== "string" ||
        typeof variable.secret !== "boolean"
      )
        return c.json({ error: `Variable inválida en «${flow.flowId}».` }, 400);
      variables.push({
        key: variable.key,
        value: variable.value,
        secret: variable.secret,
      });
    }
    if (new Set(variables.map((v) => v.key)).size !== variables.length)
      return c.json({ error: `Claves duplicadas en «${flow.flowId}».` }, 400);
    parsed.push({ flowId: flow.flowId, variables });
  }
  const results = [];
  for (const flow of parsed) {
    if (!(await getFlow(c.env, flow.flowId, scope))) {
      results.push({
        flowId: flow.flowId,
        applied: 0,
        skipped: 0,
        status: "unknown",
      });
      continue;
    }
    const { applied, skipped } = await importVariables(
      c.env,
      flow.flowId,
      flow.variables,
      scope,
    );
    results.push({
      flowId: flow.flowId,
      applied,
      skipped,
      status: applied ? "updated" : "unchanged",
    });
  }
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "variables.import",
    detail: {
      flows: results.length,
      applied: results.reduce((total, result) => total + result.applied, 0),
      skipped: results.reduce((total, result) => total + result.skipped, 0),
    },
  });
  return c.json({ results });
});
app.post("/api/flows/:id/publish", async (c) => {
  const scope = scopeOf(c.req.raw);
  const published = await publishFlow(c.env, c.req.param("id"), scope);
  if (!published) return c.json({ error: "Flow no encontrado." }, 404);
  await recordAudit(c.env, {
    tenant: scope,
    actor: actorOf(c.req.raw),
    action: "flow.publish",
    flowId: c.req.param("id"),
    detail: { version: published.id },
  });
  return c.json({ id: published.id });
});
/**
 * Audit trail for the caller's scope: who changed or revealed what, newest
 * first. Keyset pagination via `cursor` (opaque, from `nextCursor`).
 */
app.get("/api/audit", async (c) => {
  const scope = scopeOf(c.req.raw);
  const limit = Number(c.req.query("limit") ?? 50);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    return c.json({ error: "Límite inválido." }, 400);
  return c.json(
    await listAuditEvents(c.env, scope, {
      limit,
      cursor: c.req.query("cursor") ?? undefined,
    }),
  );
});
app.post("/api/flows/:id/runs", async (c) => {
  const scope = scopeOf(c.req.raw);
  const flow = await getFlow(c.env, c.req.param("id"), scope);
  if (!flow) return c.json({ error: "Flow no encontrado." }, 404);
  const body = await c.req.json();
  if (
    !["mock", "live"].includes(body.mode) ||
    !body.input ||
    typeof body.input !== "object" ||
    Array.isArray(body.input) ||
    Object.values(body.input).some((v) => typeof v !== "string")
  )
    return c.json({ error: "Envía mode e input con valores de texto." }, 400);
  return c.json(await execute(c.env, flow, body.input, body.mode, null, scope));
});
app.get("/api/flows/:id/runs", async (c) => {
  const scope = scopeOf(c.req.raw);
  return c.json(await listRuns(c.env, c.req.param("id"), scope));
});
// Read-only result access for the authenticated normalization layer.
app.get("/api/flows/:id/versions/:versionId", async (c) => {
  const scope = scopeOf(c.req.raw);
  const definition = await getVersionDefinition(
    c.env,
    c.req.param("id"),
    c.req.param("versionId"),
    scope,
  );
  if (!definition) return c.json({ error: "Versión no encontrada." }, 404);
  return c.json(JSON.parse(definition));
});
app.get("/api/flows/:id/runs/:runId", async (c) => {
  const scope = scopeOf(c.req.raw);
  const row = await getRun(
    c.env,
    c.req.param("id"),
    c.req.param("runId"),
    scope,
  );
  if (!row) return c.json({ error: "Ejecución no encontrada." }, 404);
  const definition = row.version_id
    ? await getVersionDefinition(
        c.env,
        c.req.param("id"),
        row.version_id,
        scope,
      )
    : (await getFlow(c.env, c.req.param("id"), scope))
      ? JSON.stringify(await getFlow(c.env, c.req.param("id"), scope))
      : null;
  if (!definition) return c.json({ error: "Definición no encontrada." }, 404);
  return c.json({
    run: JSON.parse(row.summary),
    flow: JSON.parse(definition),
  });
});
app.post("/v1/flows/:id/runs", async (c) => {
  const scope = scopeOf(c.req.raw);
  const body = await c.req.json();
  const version = await resolveVersion(
    c.env,
    c.req.param("id"),
    body.versionId,
    scope,
  );
  if (!version) return c.json({ error: "Publica una versión primero." }, 409);
  if (
    !["mock", "live"].includes(body.mode) ||
    !body.input ||
    typeof body.input !== "object" ||
    Array.isArray(body.input) ||
    Object.values(body.input).some((v) => typeof v !== "string")
  )
    return c.json({ error: "Envía mode e input con valores de texto." }, 400);
  return c.json(
    await execute(
      c.env,
      JSON.parse(version.definition),
      body.input,
      body.mode,
      version.id,
      scope,
    ),
  );
});
app.get("/api/openapi.json", async (c) =>
  c.json(await openApi(c.env, scopeOf(c.req.raw))),
);

app.onError((error, c) => {
  if (databaseConflict(error))
    return c.json({ error: "The data changed. Reload and retry." }, 409);
  if (databaseInputFailure(error))
    return c.json(
      { error: "The database cannot store this Unicode value." },
      422,
    );
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.json({ error: "Internal server error" }, 500);
});
app.notFound((c) => c.json({ error: "No encontrado." }, 404));
export default app;
