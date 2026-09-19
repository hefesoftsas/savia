import { dialectFor } from "@savia/db/dialect";
import { daneCityFlow } from "./dane";
import type { Env } from "./env";
import type { Flow, Variable } from "./types";
import seed from "./seed.json";
import catalog from "./catalog.json";

const insuranceAutoLightBundleId = "insurance-auto-light";
const insuranceAutoLightBundleVersion = "1.1.0";
const insuranceAutoLightFolder = "06-Cotizaciones/Autos-livianos/";
const bytes = (value: string) =>
  Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
async function key(env: Env) {
  return crypto.subtle.importKey(
    "raw",
    bytes(env.ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(env),
    new TextEncoder().encode(value),
  );
  return base64(iv) + "." + base64(new Uint8Array(encrypted));
}
export async function unseal(env: Env, value: string) {
  const [iv, data] = value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(iv) },
      await key(env),
      bytes(data),
    ),
  );
}
export async function seedOnce(env: Env) {
  for (const flow of [
    seed as Flow,
    ...(catalog as unknown as Flow[]),
    daneCityFlow,
  ]) {
    const inserted = await env.DB.prepare(
      dialectFor(env.DB).name === "postgres"
        ? "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT (id) DO NOTHING"
        : "INSERT OR IGNORE INTO flows(id,definition) VALUES(?,?)",
    )
      .bind(flow.id, JSON.stringify({ ...flow, variables: [] }))
      .run();
    if (!inserted.meta.changes) continue;
    if (flow.variables.length)
      await env.DB.batch(
        flow.variables.map((v) =>
          env.DB.prepare(
            dialectFor(env.DB).name === "postgres"
              ? "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT (flow_id,key) DO NOTHING"
              : "INSERT OR IGNORE INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
          ).bind(flow.id, v.key, v.value, v.secret ? 1 : 0),
        ),
      );
  }
}
function insuranceAutoLightFlows() {
  return (catalog as unknown as Flow[]).filter((flow) =>
    flow.steps[0]?.sourcePath?.startsWith(insuranceAutoLightFolder),
  );
}
function bundledVariables(flow: Flow): Variable[] {
  const declared = new Set(flow.variables.map((variable) => variable.key));
  const requestBodies = Object.keys(flow.input)
    .filter((key) => key.endsWith("_request_body") && !declared.has(key))
    .map((key) => ({ key, value: "", secret: false }));
  return [...flow.variables, ...requestBodies];
}
function bundledDefinition(flow: Flow) {
  const source = flow.steps[0]?.sourcePath;
  return {
    ...flow,
    variables: [],
    folderPath: source?.split("/").slice(0, -1).join("/") ?? "Mis requests",
  };
}
/** Installs the versioned Insurance package without changing configured variables or secrets. */
export async function ensureInsuranceAutoLightBundle(env: Env) {
  const flows = insuranceAutoLightFlows();
  const statements = flows.flatMap((flow) => [
    env.DB.prepare(
      "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
    ).bind(flow.id, JSON.stringify(bundledDefinition(flow))),
    ...bundledVariables(flow).map((variable) =>
      env.DB.prepare(
        dialectFor(env.DB).name === "postgres"
          ? "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT (flow_id,key) DO NOTHING"
          : "INSERT OR IGNORE INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind(flow.id, variable.key, variable.value, variable.secret ? 1 : 0),
    ),
  ]);
  statements.push(
    env.DB.prepare(
      "INSERT INTO installed_bundles(id,version,installed_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,installed_at=excluded.installed_at",
    ).bind(
      insuranceAutoLightBundleId,
      insuranceAutoLightBundleVersion,
      new Date().toISOString(),
    ),
  );
  await env.DB.batch(statements);
  return {
    id: insuranceAutoLightBundleId,
    version: insuranceAutoLightBundleVersion,
    flowIds: flows.map((flow) => flow.id),
  };
}
export async function getFlow(env: Env, id: string): Promise<Flow | null> {
  const row = await env.DB.prepare("SELECT definition FROM flows WHERE id=?")
    .bind(id)
    .first<{ definition: string }>();
  if (!row) return null;
  const flow = JSON.parse(row.definition) as Flow & { deleted?: boolean };
  if (flow.deleted) return null;
  const source =
    flow.steps[0]?.sourcePath ??
    (catalog as unknown as Flow[]).find((x) => x.id === id)?.steps[0]
      ?.sourcePath;
  flow.folderPath ??=
    source?.split("/").slice(0, -1).join("/") ?? "Mis requests";
  return flow;
}
export async function getVariables(
  env: Env,
  id: string,
  privateValues = false,
): Promise<Variable[]> {
  const rows = await env.DB.prepare(
    "SELECT key,value,secret FROM flow_variables WHERE flow_id=? ORDER BY key",
  )
    .bind(id)
    .all<{ key: string; value: string; secret: number }>();
  return Promise.all(
    rows.results.map(async (row) => ({
      key: row.key,
      secret: !!row.secret,
      configured: !!row.value,
      value: row.secret
        ? privateValues && row.value
          ? await unseal(env, row.value)
          : ""
        : row.value,
    })),
  );
}
export async function saveVariables(env: Env, id: string, rows: Variable[]) {
  const existing = await env.DB.prepare(
    "SELECT key,value,secret FROM flow_variables WHERE flow_id=?",
  )
    .bind(id)
    .all<{ key: string; value: string; secret: number }>();
  const statements = [];
  for (const row of rows) {
    const old = existing.results.find((x) => x.key === row.key);
    if (old?.secret && old.value && !row.value) {
      if (!row.secret)
        throw new Error("Para desmarcar un secreto debes reemplazar su valor.");
      continue;
    }
    const value =
      row.secret && row.value ? await seal(env, row.value) : row.value;
    statements.push(
      env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT(flow_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret",
      ).bind(id, row.key, value, row.secret ? 1 : 0),
    );
  }
  for (const row of existing.results)
    if (!rows.some((x) => x.key === row.key))
      statements.push(
        env.DB.prepare(
          "DELETE FROM flow_variables WHERE flow_id=? AND key=?",
        ).bind(id, row.key),
      );
  if (statements.length) await env.DB.batch(statements);
}
