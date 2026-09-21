import { databaseConflict, databaseInputFailure } from "@savia/db/errors";
import { HTTPException } from "hono/http-exception";
import { dialectFor } from "@savia/db/dialect";
import { lookupDaneCity } from "./dane";
import { openApi } from "./openapi";
import { Hono } from "hono";
import type { Env } from "./env";
import type { Flow, Variable } from "./types";
import {
  ensureInsuranceAutoLightBundle,
  getFlow,
  getVariables,
  importVariables,
  saveVariables,
  seedOnce,
} from "./store";
import { execute } from "./runner";
import { demoInput } from "./mock";
const app = new Hono<{ Bindings: Env }>();
app.use("*", async (c, next) => {
  if (new URL(c.req.url).hostname !== "savia-request.internal")
    return c.json({ error: "Acceso privado." }, 403);
  if (
    ["POST", "PUT", "DELETE"].includes(c.req.method) &&
    !c.req.header("content-type")?.startsWith("application/json")
  )
    return c.json({ error: "Usa application/json." }, 415);
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
app.post("/api/bundles/insurance-auto-light/ensure", async (c) =>
  c.json(await ensureInsuranceAutoLightBundle(c.env)),
);
app.get("/api/flows", async (c) => {
  await seedOnce(c.env);
  const dialect = dialectFor(c.env.DB);
  const visible = dialect.jsonCompare("definition", "$.deleted", "eq", 0);
  const absent = dialect.jsonCompare("definition", "$.deleted", "eq", null);
  const rows = await c.env.DB.prepare(
    `SELECT id,definition FROM flows WHERE (${visible.sql}) OR (${absent.sql}) ORDER BY id`,
  )
    .bind(...visible.parameters, ...absent.parameters)
    .all<{ id: string; definition: string }>();
  return c.json(
    await Promise.all(
      rows.results.map(async (row) => {
        const flow = await getFlow(c.env, row.id);
        return {
          id: row.id,
          name: flow!.name,
          folderPath: flow!.folderPath,
          steps: flow!.steps.map((s) => ({
            id: s.id,
            name: s.name,
            method: s.method,
          })),
        };
      }),
    ),
  );
});
app.get("/api/folders", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT path FROM folders ORDER BY path",
  ).all<{ path: string }>();
  return c.json(rows.results.map((r) => r.path));
});
app.post("/api/folders", async (c) => {
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
  const existing = await c.env.DB.prepare(
    "SELECT path FROM folders WHERE path=?",
  )
    .bind(normalized)
    .first();
  if (existing)
    return c.json({ error: "Ya existe una carpeta en esa ubicación." }, 409);
  await c.env.DB.batch(
    parts.map((_, index) =>
      c.env.DB.prepare(
        dialectFor(c.env.DB).name === "postgres"
          ? "INSERT INTO folders(path) VALUES(?) ON CONFLICT (path) DO NOTHING"
          : "INSERT OR IGNORE INTO folders(path) VALUES(?)",
      ).bind(parts.slice(0, index + 1).join("/")),
    ),
  );
  return c.json({ path: normalized }, 201);
});
app.delete("/api/folders", async (c) => {
  const { path } = await c.req.json();
  if (typeof path !== "string" || !path.trim())
    return c.json({ error: "Carpeta inválida." }, 400);
  const rows = await c.env.DB.prepare("SELECT id FROM flows").all<{
    id: string;
  }>();
  for (const row of rows.results) {
    const flow = await getFlow(c.env, row.id);
    if (flow?.folderPath === path || flow?.folderPath?.startsWith(path + "/"))
      return c.json(
        {
          error:
            "La carpeta contiene requests. Muévelos a otra carpeta antes de eliminarla.",
        },
        409,
      );
  }
  await c.env.DB.prepare(
    "DELETE FROM folders WHERE path=? OR substr(path,1,length(?)+1)=?",
  )
    .bind(path, path, path + "/")
    .run();
  return c.json({ ok: true });
});
app.post("/api/flows/:id/duplicate", async (c) => {
  const source = await getFlow(c.env, c.req.param("id"));
  if (!source) return c.json({ error: "Request no encontrado." }, 404);
  const id = "request-" + crypto.randomUUID();
  const copy = {
    ...source,
    id,
    name: source.name + " (copia)",
    steps: source.steps.map((step) => ({ ...step, id: crypto.randomUUID() })),
  };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO flows(id,definition) VALUES(?,?)").bind(
      id,
      JSON.stringify(copy),
    ),
    c.env.DB.prepare(
      "INSERT INTO flow_variables(flow_id,key,value,secret) SELECT ?,key,value,secret FROM flow_variables WHERE flow_id=?",
    ).bind(id, source.id),
  ]);
  return c.json({ id, name: copy.name }, 201);
});
app.delete("/api/flows/:id", async (c) => {
  const id = c.req.param("id");
  const flow = await getFlow(c.env, id);
  if (!flow) return c.json({ error: "Request no encontrado." }, 404);
  await c.env.DB.prepare(
    dialectFor(c.env.DB).name === "postgres"
      ? "UPDATE flows SET definition=jsonb_set(definition::jsonb,'{deleted}','true'::jsonb)::text WHERE id=?"
      : "UPDATE flows SET definition=json_set(definition,'$.deleted',json('true')) WHERE id=?",
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});
app.post("/api/flows/:id/variables/reveal", async (c) => {
  const { key } = await c.req.json();
  const rows = await getVariables(c.env, c.req.param("id"), true);
  const variable = rows.find((v) => v.key === key);
  if (!variable) return c.json({ error: "Variable no encontrada." }, 404);
  return c.json({ value: variable.value });
});
app.get("/api/demo-input", (c) => c.json(demoInput));
app.get("/api/flows/:id", async (c) => {
  const flow = await getFlow(c.env, c.req.param("id"));
  if (!flow) return c.json({ error: "Flow no encontrado." }, 404);
  const versions = await c.env.DB.prepare(
    "SELECT id,created_at FROM flow_versions WHERE flow_id=? ORDER BY created_at DESC",
  )
    .bind(flow.id)
    .all();
  return c.json({
    ...flow,
    variables: await getVariables(c.env, flow.id),
    versions: versions.results,
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
  const flow = await c.req.json<Flow>();
  flow.id = c.req.param("id");
  validateFlow(flow);
  const definition = {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    steps: flow.steps,
    input: flow.input,
    variables: [],
    provider: flow.provider,
    kind: flow.kind,
    resultPrefix: flow.resultPrefix,
    allowedOrigins: flow.allowedOrigins,
    folderPath: flow.folderPath,
  };
  await c.env.DB.prepare(
    "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
  )
    .bind(flow.id, JSON.stringify(definition))
    .run();
  return c.json({ ok: true });
});
app.put("/api/flows/:id/variables", async (c) => {
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
  const flow = await getFlow(c.env, c.req.param("id"));
  if (!flow) return c.json({ error: "Flow no encontrado." }, 404);
  await saveVariables(c.env, flow.id, rows);
  return c.json({ ok: true });
});
/** Single-request bulk transfer so moving secrets between environments is fast. */
app.get("/api/variables/export", async (c) => {
  await seedOnce(c.env);
  const dialect = dialectFor(c.env.DB);
  const visible = dialect.jsonCompare("definition", "$.deleted", "eq", 0);
  const absent = dialect.jsonCompare("definition", "$.deleted", "eq", null);
  const rows = await c.env.DB.prepare(
    `SELECT id FROM flows WHERE (${visible.sql}) OR (${absent.sql}) ORDER BY id`,
  )
    .bind(...visible.parameters, ...absent.parameters)
    .all<{ id: string }>();
  const flows = [];
  for (const row of rows.results) {
    const variables = await getVariables(c.env, row.id, true);
    if (variables.length)
      flows.push({
        flowId: row.id,
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
    flows,
  });
});
app.post("/api/variables/import", async (c) => {
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
    if (!(await getFlow(c.env, flow.flowId))) {
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
    );
    results.push({
      flowId: flow.flowId,
      applied,
      skipped,
      status: applied ? "updated" : "unchanged",
    });
  }
  return c.json({ results });
});
app.post("/api/flows/:id/publish", async (c) => {
  const flow = await getFlow(c.env, c.req.param("id"));
  if (!flow) return c.json({ error: "Flow no encontrado." }, 404);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO flow_versions(id,flow_id,definition,created_at) VALUES(?,?,?,?)",
  )
    .bind(id, flow.id, JSON.stringify(flow), new Date().toISOString())
    .run();
  return c.json({ id });
});
app.post("/api/flows/:id/runs", async (c) => {
  const flow = await getFlow(c.env, c.req.param("id"));
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
  return c.json(await execute(c.env, flow, body.input, body.mode, null));
});
app.get("/api/flows/:id/runs", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT summary FROM flow_runs WHERE flow_id=? ORDER BY created_at DESC LIMIT 20",
  )
    .bind(c.req.param("id"))
    .all<{ summary: string }>();
  return c.json(rows.results.map((row) => JSON.parse(row.summary)));
});
// Read-only result access for the authenticated normalization layer.
app.get("/api/flows/:id/versions/:versionId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT definition FROM flow_versions WHERE flow_id=? AND id=?",
  )
    .bind(c.req.param("id"), c.req.param("versionId"))
    .first<{ definition: string }>();
  if (!row) return c.json({ error: "Versión no encontrada." }, 404);
  return c.json(JSON.parse(row.definition));
});
app.get("/api/flows/:id/runs/:runId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT summary,version_id FROM flow_runs WHERE flow_id=? AND id=?",
  )
    .bind(c.req.param("id"), c.req.param("runId"))
    .first<{ summary: string; version_id: string | null }>();
  if (!row) return c.json({ error: "Ejecución no encontrada." }, 404);
  const flow = row.version_id
    ? await c.env.DB.prepare(
        "SELECT definition FROM flow_versions WHERE flow_id=? AND id=?",
      )
        .bind(c.req.param("id"), row.version_id)
        .first<{ definition: string }>()
    : await c.env.DB.prepare("SELECT definition FROM flows WHERE id=?")
        .bind(c.req.param("id"))
        .first<{ definition: string }>();
  if (!flow) return c.json({ error: "Definición no encontrada." }, 404);
  return c.json({
    run: JSON.parse(row.summary),
    flow: JSON.parse(flow.definition),
  });
});
app.post("/v1/flows/:id/runs", async (c) => {
  const body = await c.req.json();
  const version = body.versionId
    ? await c.env.DB.prepare(
        "SELECT id,definition FROM flow_versions WHERE id=? AND flow_id=?",
      )
        .bind(body.versionId, c.req.param("id"))
        .first<{ id: string; definition: string }>()
    : await c.env.DB.prepare(
        "SELECT id,definition FROM flow_versions WHERE flow_id=? ORDER BY created_at DESC LIMIT 1",
      )
        .bind(c.req.param("id"))
        .first<{ id: string; definition: string }>();
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
    ),
  );
});
app.get("/api/openapi.json", async (c) => c.json(await openApi(c.env)));

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
