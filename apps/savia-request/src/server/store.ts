import { dialectFor } from "@savia/db/dialect";
import { daneCityFlow } from "./dane";
import type { Env } from "./env";
import type { Flow, Run, Variable } from "./types";
import seed from "./seed.json";
import catalog from "./catalog.json";
import { isPlatformTenant, scopeTenant } from "./tenant";

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

export { scopeTenant };

const nowIso = () => new Date().toISOString();

type StoredVariable = { key: string; value: string; secret: number };

async function baseVariables(env: Env, id: string): Promise<StoredVariable[]> {
  const rows = await env.DB.prepare(
    "SELECT key,value,secret FROM flow_variables WHERE flow_id=?",
  )
    .bind(id)
    .all<StoredVariable>();
  return rows.results;
}

async function overlayVariables(
  env: Env,
  tenant: string,
  id: string,
): Promise<StoredVariable[]> {
  const rows = await env.DB.prepare(
    "SELECT key,value,secret FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=?",
  )
    .bind(tenant, id)
    .all<StoredVariable>();
  return rows.results;
}

function parseFlowDefinition(
  definition: string,
): (Flow & { deleted?: boolean }) | null {
  try {
    return JSON.parse(definition) as Flow & { deleted?: boolean };
  } catch {
    return null;
  }
}

function withFolderFallback(
  flow: Flow & { deleted?: boolean },
): Flow & { deleted?: boolean } {
  const source =
    flow.steps[0]?.sourcePath ??
    (catalog as unknown as Flow[]).find((x) => x.id === flow.id)?.steps[0]
      ?.sourcePath;
  flow.folderPath ??=
    source?.split("/").slice(0, -1).join("/") ?? "Mis requests";
  return flow;
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

/** Deterministic JSON so definition hashes are stable across writes. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

/**
 * Bundle content identity: folder moves and variable scaffolding never mark
 * a flow as drifted; step/input/config changes do. Exported for tests that
 * fabricate older installs.
 */
export function bundleContentHash(definition: Record<string, unknown>): string {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(definition)) {
    if (key === "variables" || key === "deleted" || key === "folderPath")
      continue;
    content[key] = value;
  }
  const serialized = stableStringify(content);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function recordBundleFlowState(
  env: Env,
  scope: string,
  flowId: string,
  definition: Record<string, unknown>,
) {
  return env.DB.prepare(
    dialectFor(env.DB).name === "postgres"
      ? "INSERT INTO bundle_flow_state(scope,flow_id,bundle_version,content_hash,updated_at) VALUES(?,?,?,?,?) ON CONFLICT (scope,flow_id) DO UPDATE SET bundle_version=excluded.bundle_version,content_hash=excluded.content_hash,updated_at=excluded.updated_at"
      : "INSERT INTO bundle_flow_state(scope,flow_id,bundle_version,content_hash,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(scope,flow_id) DO UPDATE SET bundle_version=excluded.bundle_version,content_hash=excluded.content_hash,updated_at=excluded.updated_at",
  ).bind(
    scope,
    flowId,
    insuranceAutoLightBundleVersion,
    bundleContentHash(definition),
    nowIso(),
  );
}

async function readBundleFlowState(
  env: Env,
  scope: string,
  flowId: string,
): Promise<{ bundle_version: string; content_hash: string } | null> {
  return env.DB.prepare(
    "SELECT bundle_version,content_hash FROM bundle_flow_state WHERE scope=? AND flow_id=?",
  )
    .bind(scope, flowId)
    .first<{ bundle_version: string; content_hash: string }>();
}

/** Raw effective definition distinguishing hidden (tombstone) from missing. */
async function rawScopeDefinition(
  env: Env,
  flowId: string,
  scope: string,
): Promise<{ definition: string } | { tombstone: true } | null> {
  if (!isPlatformTenant(scope)) {
    const overlay = await env.DB.prepare(
      "SELECT definition FROM tenant_flows WHERE tenant_id=? AND flow_id=?",
    )
      .bind(scope, flowId)
      .first<{ definition: string }>();
    if (overlay) {
      const parsed = parseFlowDefinition(overlay.definition);
      if (!parsed || parsed.deleted) return { tombstone: true };
      return { definition: overlay.definition };
    }
  }
  const row = await env.DB.prepare("SELECT definition FROM flows WHERE id=?")
    .bind(flowId)
    .first<{ definition: string }>();
  if (!row) return null;
  const parsed = parseFlowDefinition(row.definition);
  if (!parsed || parsed.deleted) return { tombstone: true };
  return { definition: row.definition };
}

async function installedBundleVersion(
  env: Env,
  scope: string,
): Promise<string | null> {
  const row = isPlatformTenant(scope)
    ? await env.DB.prepare("SELECT version FROM installed_bundles WHERE id=?")
        .bind(insuranceAutoLightBundleId)
        .first<{ version: string }>()
    : await env.DB.prepare(
        "SELECT version FROM tenant_bundles WHERE tenant_id=? AND id=?",
      )
        .bind(scope, insuranceAutoLightBundleId)
        .first<{ version: string }>();
  return row?.version ?? null;
}
/**
 * Installs the versioned Insurance package without changing configured
 * variables or secrets. With a tenant scope, definitions go to the tenant
 * overlay and the global catalog is left untouched.
 */
export async function ensureInsuranceAutoLightBundle(env: Env, tenant = "") {
  const scope = scopeTenant(tenant);
  const flows = insuranceAutoLightFlows();
  if (isPlatformTenant(scope)) {
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
        nowIso(),
      ),
    );
    await env.DB.batch(statements);
    await env.DB.batch(
      flows.map((flow) =>
        recordBundleFlowState(
          env,
          scope,
          flow.id,
          bundledDefinition(flow) as Record<string, unknown>,
        ),
      ),
    );
    return {
      id: insuranceAutoLightBundleId,
      version: insuranceAutoLightBundleVersion,
      flowIds: flows.map((flow) => flow.id),
    };
  }
  // Tenant scope: never touch the global catalog. Tenant tombstones
  // (explicitly hidden flows) are respected and not resurrected.
  const tombstones = await env.DB.prepare(
    "SELECT flow_id,definition FROM tenant_flows WHERE tenant_id=?",
  )
    .bind(scope)
    .all<{ flow_id: string; definition: string }>();
  const hidden = new Set(
    tombstones.results
      .filter((row) => parseFlowDefinition(row.definition)?.deleted)
      .map((row) => row.flow_id),
  );
  const pending = [];
  for (const flow of flows) {
    if (hidden.has(flow.id)) continue;
    pending.push(
      env.DB.prepare(
        "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,flow_id) DO UPDATE SET definition=excluded.definition,updated_at=excluded.updated_at",
      ).bind(scope, flow.id, JSON.stringify(bundledDefinition(flow)), nowIso()),
    );
    pending.push(
      recordBundleFlowState(
        env,
        scope,
        flow.id,
        bundledDefinition(flow) as Record<string, unknown>,
      ),
    );
    for (const variable of bundledVariables(flow)) {
      pending.push(
        env.DB.prepare(
          dialectFor(env.DB).name === "postgres"
            ? "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT (tenant_id,flow_id,key) DO NOTHING"
            : "INSERT OR IGNORE INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?)",
        ).bind(
          scope,
          flow.id,
          variable.key,
          variable.value,
          variable.secret ? 1 : 0,
          nowIso(),
        ),
      );
    }
  }
  pending.push(
    env.DB.prepare(
      "INSERT INTO tenant_bundles(tenant_id,id,version,installed_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET version=excluded.version,installed_at=excluded.installed_at",
    ).bind(
      scope,
      insuranceAutoLightBundleId,
      insuranceAutoLightBundleVersion,
      nowIso(),
    ),
  );
  // Chunked batches stay within driver batch limits.
  for (let index = 0; index < pending.length; index += 50) {
    const chunk = pending.slice(index, index + 50);
    if (chunk.length) await env.DB.batch(chunk);
  }
  return {
    id: insuranceAutoLightBundleId,
    version: insuranceAutoLightBundleVersion,
    flowIds: flows.map((flow) => flow.id),
  };
}

export type BundleFlowState =
  "current" | "customized" | "outdated" | "hidden" | "not-installed";

export type BundleStatus = {
  id: string;
  currentVersion: string;
  installedVersion: string | null;
  updateAvailable: boolean;
  flows: Array<{ flowId: string; state: BundleFlowState }>;
  summary: Record<BundleFlowState, number>;
};

/**
 * Compares the scope's effective definitions against the current bundle
 * without writing anything. `outdated` means a pristine install the bundle
 * moved past (safe to sync); `customized` means someone edited it after
 * installing (sync skips unless forced).
 */
export async function bundleStatus(
  env: Env,
  tenant = "",
): Promise<BundleStatus> {
  const scope = scopeTenant(tenant);
  const flows = insuranceAutoLightFlows();
  const installedVersion = await installedBundleVersion(env, scope);
  const states: Array<{ flowId: string; state: BundleFlowState }> = [];
  for (const flow of flows) {
    const raw = await rawScopeDefinition(env, flow.id, scope);
    if (!raw) {
      states.push({ flowId: flow.id, state: "not-installed" });
      continue;
    }
    if ("tombstone" in raw) {
      states.push({ flowId: flow.id, state: "hidden" });
      continue;
    }
    const effective = JSON.parse(raw.definition) as Record<string, unknown>;
    if (
      bundleContentHash(effective) ===
      bundleContentHash(bundledDefinition(flow) as Record<string, unknown>)
    ) {
      states.push({ flowId: flow.id, state: "current" });
      continue;
    }
    const record = await readBundleFlowState(env, scope, flow.id);
    states.push({
      flowId: flow.id,
      state:
        record && record.content_hash === bundleContentHash(effective)
          ? "outdated"
          : "customized",
    });
  }
  const summary: Record<BundleFlowState, number> = {
    current: 0,
    customized: 0,
    outdated: 0,
    hidden: 0,
    "not-installed": 0,
  };
  for (const entry of states) summary[entry.state] += 1;
  return {
    id: insuranceAutoLightBundleId,
    currentVersion: insuranceAutoLightBundleVersion,
    installedVersion,
    updateAvailable:
      summary.outdated > 0 ||
      (installedVersion !== null &&
        installedVersion !== insuranceAutoLightBundleVersion),
    flows: states,
    summary,
  };
}

export type BundleSyncInput = { flowIds?: string[]; force?: boolean };

export type BundleSyncResult = {
  id: string;
  version: string;
  updated: string[];
  installed: string[];
  skippedCustomized: string[];
  hidden: string[];
  variablesAdded: number;
};

function variableUpsert(
  env: Env,
  scope: string,
  flowId: string,
  variable: Variable,
): ReturnType<Env["DB"]["prepare"]> {
  return isPlatformTenant(scope)
    ? env.DB.prepare(
        dialectFor(env.DB).name === "postgres"
          ? "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT (flow_id,key) DO NOTHING"
          : "INSERT OR IGNORE INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?)",
      ).bind(flowId, variable.key, variable.value, variable.secret ? 1 : 0)
    : env.DB.prepare(
        dialectFor(env.DB).name === "postgres"
          ? "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT (tenant_id,flow_id,key) DO NOTHING"
          : "INSERT OR IGNORE INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        scope,
        flowId,
        variable.key,
        variable.value,
        variable.secret ? 1 : 0,
        nowIso(),
      );
}

async function missingVariableKeys(
  env: Env,
  scope: string,
  flowId: string,
  wanted: string[],
): Promise<string[]> {
  const existing = isPlatformTenant(scope)
    ? await env.DB.prepare("SELECT key FROM flow_variables WHERE flow_id=?")
        .bind(flowId)
        .all<{ key: string }>()
    : await env.DB.prepare(
        "SELECT key FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=?",
      )
        .bind(scope, flowId)
        .all<{ key: string }>();
  const known = new Set(existing.results.map((row) => row.key));
  return wanted.filter((key) => !known.has(key));
}

/**
 * Brings bundle flows up to date without ever overwriting configured
 * variables or resurrecting hidden flows. Pristine-but-outdated definitions
 * and missing flows are (re)installed; customized definitions are skipped
 * unless `force` is set. `flowIds` limits the operation to those flows.
 * Tenant folder placement is preserved on updates.
 */
export async function syncInsuranceAutoLightBundle(
  env: Env,
  tenant = "",
  input: BundleSyncInput = {},
): Promise<BundleSyncResult> {
  const scope = scopeTenant(tenant);
  const requested = input.flowIds === undefined ? null : new Set(input.flowIds);
  const flows = insuranceAutoLightFlows().filter(
    (flow) => !requested || requested.has(flow.id),
  );
  const updated: string[] = [];
  const installed: string[] = [];
  const skippedCustomized: string[] = [];
  const hidden: string[] = [];
  let variablesAdded = 0;
  const pending: Array<ReturnType<Env["DB"]["prepare"]>> = [];
  const flush = async () => {
    for (let index = 0; index < pending.length; index += 50) {
      const chunk = pending.slice(index, index + 50);
      if (chunk.length) await env.DB.batch(chunk);
    }
    pending.length = 0;
  };

  for (const flow of flows) {
    const raw = await rawScopeDefinition(env, flow.id, scope);
    if (raw && "tombstone" in raw) {
      hidden.push(flow.id);
      continue;
    }
    const bundle = bundledDefinition(flow) as Record<string, unknown>;
    if (!raw) {
      // Fresh install into scope.
      if (isPlatformTenant(scope)) {
        pending.push(
          env.DB.prepare(
            "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
          ).bind(flow.id, JSON.stringify(bundle)),
        );
      } else {
        pending.push(
          env.DB.prepare(
            "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,flow_id) DO UPDATE SET definition=excluded.definition,updated_at=excluded.updated_at",
          ).bind(scope, flow.id, JSON.stringify(bundle), nowIso()),
        );
      }
      pending.push(recordBundleFlowState(env, scope, flow.id, bundle));
      const missing = await missingVariableKeys(
        env,
        scope,
        flow.id,
        bundledVariables(flow).map((variable) => variable.key),
      );
      for (const variable of bundledVariables(flow)) {
        if (!missing.includes(variable.key)) continue;
        pending.push(variableUpsert(env, scope, flow.id, variable));
        variablesAdded += 1;
      }
      installed.push(flow.id);
      continue;
    }
    const effective = JSON.parse(raw.definition) as Record<string, unknown>;
    if (bundleContentHash(effective) === bundleContentHash(bundle)) continue;
    const record = await readBundleFlowState(env, scope, flow.id);
    const pristine =
      !!record && record.content_hash === bundleContentHash(effective);
    if (!pristine && !input.force) {
      skippedCustomized.push(flow.id);
      continue;
    }
    const next = {
      ...bundle,
      folderPath:
        typeof effective.folderPath === "string" && effective.folderPath
          ? effective.folderPath
          : bundle.folderPath,
    };
    if (isPlatformTenant(scope)) {
      pending.push(
        env.DB.prepare(
          "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
        ).bind(flow.id, JSON.stringify(next)),
      );
    } else {
      pending.push(
        env.DB.prepare(
          "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,flow_id) DO UPDATE SET definition=excluded.definition,updated_at=excluded.updated_at",
        ).bind(scope, flow.id, JSON.stringify(next), nowIso()),
      );
    }
    pending.push(recordBundleFlowState(env, scope, flow.id, next));
    const missing = await missingVariableKeys(
      env,
      scope,
      flow.id,
      bundledVariables(flow).map((variable) => variable.key),
    );
    for (const variable of bundledVariables(flow)) {
      if (!missing.includes(variable.key)) continue;
      pending.push(variableUpsert(env, scope, flow.id, variable));
      variablesAdded += 1;
    }
    updated.push(flow.id);
  }
  await flush();
  const marker = isPlatformTenant(scope)
    ? env.DB.prepare(
        "INSERT INTO installed_bundles(id,version,installed_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,installed_at=excluded.installed_at",
      ).bind(
        insuranceAutoLightBundleId,
        insuranceAutoLightBundleVersion,
        nowIso(),
      )
    : env.DB.prepare(
        "INSERT INTO tenant_bundles(tenant_id,id,version,installed_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET version=excluded.version,installed_at=excluded.installed_at",
      ).bind(
        scope,
        insuranceAutoLightBundleId,
        insuranceAutoLightBundleVersion,
        nowIso(),
      );
  await env.DB.batch([marker]);
  return {
    id: insuranceAutoLightBundleId,
    version: insuranceAutoLightBundleVersion,
    updated,
    installed,
    skippedCustomized,
    hidden,
    variablesAdded,
  };
}

/** Effective definition: tenant overlay wins, otherwise the global catalog. */
export async function getFlow(
  env: Env,
  id: string,
  tenant = "",
): Promise<Flow | null> {
  const scope = scopeTenant(tenant);
  if (!isPlatformTenant(scope)) {
    const overlay = await env.DB.prepare(
      "SELECT definition FROM tenant_flows WHERE tenant_id=? AND flow_id=?",
    )
      .bind(scope, id)
      .first<{ definition: string }>();
    if (overlay) {
      const flow = parseFlowDefinition(overlay.definition);
      if (!flow || flow.deleted) return null;
      return { ...(withFolderFallback(flow) as Flow), customized: true };
    }
  }
  const row = await env.DB.prepare("SELECT definition FROM flows WHERE id=?")
    .bind(id)
    .first<{ definition: string }>();
  if (!row) return null;
  const flow = parseFlowDefinition(row.definition);
  if (!flow || flow.deleted) return null;
  return { ...(withFolderFallback(flow) as Flow), customized: false };
}

/** Every visible flow id in scope (global + tenant overlays, minus tombstones). */
export async function listScopedFlowIds(
  env: Env,
  tenant = "",
): Promise<string[]> {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope)) {
    const rows = await env.DB.prepare("SELECT id FROM flows ORDER BY id").all<{
      id: string;
    }>();
    return rows.results.map((row) => row.id);
  }
  const globals = await env.DB.prepare("SELECT id FROM flows").all<{
    id: string;
  }>();
  const overlays = await env.DB.prepare(
    "SELECT flow_id FROM tenant_flows WHERE tenant_id=?",
  )
    .bind(scope)
    .all<{ flow_id: string }>();
  const ids = new Set<string>([
    ...globals.results.map((row) => row.id),
    ...overlays.results.map((row) => row.flow_id),
  ]);
  return [...ids].sort();
}

/** Every visible flow definition in scope. */
export async function listScopedFlows(env: Env, tenant = ""): Promise<Flow[]> {
  const flows: Flow[] = [];
  for (const id of await listScopedFlowIds(env, tenant)) {
    const flow = await getFlow(env, id, tenant);
    if (flow) flows.push(flow);
  }
  return flows;
}

/**
 * Effective variables: tenant overlay wins per key, otherwise the global
 * default. Reads and reveals never expose base secrets to tenant scopes
 * (`value: ""`, `configured` from either layer); only tenant-owned secrets
 * can be revealed. Server-side execution (`decryptBaseSecrets`) resolves
 * base secrets too, so shared catalog flows run for tenants — values stay
 * in memory, hooks can never touch secrets, and response previews redact
 * them before anything is persisted or returned.
 */
export async function getVariables(
  env: Env,
  id: string,
  privateValues = false,
  tenant = "",
  decryptBaseSecrets = false,
): Promise<Variable[]> {
  const scope = scopeTenant(tenant);
  const base = await baseVariables(env, id);
  if (isPlatformTenant(scope)) {
    return Promise.all(
      base.map(async (row) => ({
        key: row.key,
        secret: !!row.secret,
        configured: !!row.value,
        overridden: false,
        value: row.secret
          ? privateValues && row.value
            ? await unseal(env, row.value)
            : ""
          : row.value,
      })),
    );
  }
  const overlay = await overlayVariables(env, scope, id);
  const baseByKey = new Map(base.map((row) => [row.key, row]));
  const overlayByKey = new Map(overlay.map((row) => [row.key, row]));
  const keys = [
    ...new Set([...baseByKey.keys(), ...overlayByKey.keys()]),
  ].sort();
  return Promise.all(
    keys.map(async (key) => {
      const baseRow = baseByKey.get(key);
      const overlayRow = overlayByKey.get(key);
      const secret = overlayRow ? !!overlayRow.secret : !!baseRow?.secret;
      const configured = !!(overlayRow?.value || baseRow?.value);
      const overridden = Boolean(overlayRow);
      if (!secret) {
        return {
          key,
          secret,
          configured,
          overridden,
          value: overlayRow ? overlayRow.value : (baseRow?.value ?? ""),
        };
      }
      // Secret: tenant-owned values are readable when requested; base
      // values only for server-side execution, never for reads/reveals.
      if (overlayRow?.value) {
        return {
          key,
          secret,
          configured,
          overridden,
          value: privateValues ? await unseal(env, overlayRow.value) : "",
        };
      }
      if (privateValues && decryptBaseSecrets && baseRow?.value) {
        return {
          key,
          secret,
          configured,
          overridden,
          value: await unseal(env, baseRow.value),
        };
      }
      return { key, secret, configured, overridden, value: "" };
    }),
  );
}

/**
 * Platform scope keeps the legacy replace-all semantics on `flow_variables`.
 * Tenant scope replaces the tenant overlay only: an empty secret value means
 * "no override" (falls back to the platform default) so masked secrets sent
 * back by the editor are never stored as empty overrides.
 */
export async function saveVariables(
  env: Env,
  id: string,
  rows: Variable[],
  tenant = "",
) {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope)) {
    const existing = await baseVariables(env, id);
    const statements = [];
    for (const row of rows) {
      const old = existing.find((x) => x.key === row.key);
      if (old?.secret && old.value && !row.value) {
        if (!row.secret)
          throw new Error(
            "Para desmarcar un secreto debes reemplazar su valor.",
          );
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
    for (const row of existing)
      if (!rows.some((x) => x.key === row.key))
        statements.push(
          env.DB.prepare(
            "DELETE FROM flow_variables WHERE flow_id=? AND key=?",
          ).bind(id, row.key),
        );
    if (statements.length) await env.DB.batch(statements);
    return;
  }
  const existing = await overlayVariables(env, scope, id);
  const existingByKey = new Map(existing.map((row) => [row.key, row]));
  const statements = [];
  for (const row of rows) {
    // Masked secret sent back untouched: keep a stored tenant secret, or keep
    // falling back to the platform default when there is no tenant override.
    if (row.secret && !row.value) {
      if (!row.secret)
        throw new Error("Para desmarcar un secreto debes reemplazar su valor.");
      continue;
    }
    const value =
      row.secret && row.value ? await seal(env, row.value) : row.value;
    statements.push(
      env.DB.prepare(
        "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,flow_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret,updated_at=excluded.updated_at",
      ).bind(scope, id, row.key, value, row.secret ? 1 : 0, nowIso()),
    );
  }
  for (const row of existing)
    if (!rows.some((x) => x.key === row.key))
      statements.push(
        env.DB.prepare(
          "DELETE FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=? AND key=?",
        ).bind(scope, id, row.key),
      );
  void existingByKey;
  if (statements.length) await env.DB.batch(statements);
}

/**
 * Merges transferred variables without deleting anything: nonempty file
 * values win (sealed when secret); empty values keep the stored value.
 * Tenant scope writes to the overlay and never touches the global catalog.
 */
export async function importVariables(
  env: Env,
  id: string,
  rows: Variable[],
  tenant = "",
): Promise<{ applied: number; skipped: number }> {
  const scope = scopeTenant(tenant);
  const statements = [];
  let applied = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.value) {
      skipped += 1;
      continue;
    }
    const value =
      row.secret && row.value ? await seal(env, row.value) : row.value;
    statements.push(
      isPlatformTenant(scope)
        ? env.DB.prepare(
            "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES(?,?,?,?) ON CONFLICT(flow_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret",
          ).bind(id, row.key, value, row.secret ? 1 : 0)
        : env.DB.prepare(
            "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,flow_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret,updated_at=excluded.updated_at",
          ).bind(scope, id, row.key, value, row.secret ? 1 : 0, nowIso()),
    );
    applied += 1;
  }
  if (statements.length) await env.DB.batch(statements);
  return { applied, skipped };
}

/** Persists an effective definition in scope (tenant overlay or global). */
export async function saveFlow(
  env: Env,
  flow: Flow,
  tenant = "",
): Promise<void> {
  const scope = scopeTenant(tenant);
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
  if (isPlatformTenant(scope)) {
    await env.DB.prepare(
      "INSERT INTO flows(id,definition) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
    )
      .bind(flow.id, JSON.stringify(definition))
      .run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,flow_id) DO UPDATE SET definition=excluded.definition,updated_at=excluded.updated_at",
  )
    .bind(scope, flow.id, JSON.stringify(definition), nowIso())
    .run();
}

/** Soft-delete in scope: tenant tombstones hide the global flow. */
export async function deleteFlow(
  env: Env,
  id: string,
  tenant = "",
): Promise<boolean> {
  const scope = scopeTenant(tenant);
  const flow = await getFlow(env, id, scope);
  if (!flow) return false;
  if (isPlatformTenant(scope)) {
    await env.DB.prepare(
      dialectFor(env.DB).name === "postgres"
        ? "UPDATE flows SET definition=jsonb_set(definition::jsonb,'{deleted}','true'::jsonb)::text WHERE id=?"
        : "UPDATE flows SET definition=json_set(definition,'$.deleted',json('true')) WHERE id=?",
    )
      .bind(id)
      .run();
    return true;
  }
  await env.DB.prepare(
    "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,flow_id) DO UPDATE SET definition=excluded.definition,updated_at=excluded.updated_at",
  )
    .bind(
      scope,
      id,
      JSON.stringify({ ...flow, variables: [], deleted: true }),
      nowIso(),
    )
    .run();
  return true;
}

export type ResetStatus =
  "unknown-flow" | "unknown-key" | "unchanged" | "reverted";

function requireTenantScope(scope: string): void {
  if (isPlatformTenant(scope))
    throw new Error("El restablecido solo aplica a scopes de tenant.");
}

/**
 * Reverts a tenant customization back to the platform catalog by removing
 * its definition and variable overlays. Tenant-only flows (no global
 * counterpart) disappear; versions and runs are kept as history.
 */
export async function resetFlow(
  env: Env,
  id: string,
  tenant: string,
): Promise<ResetStatus> {
  const scope = scopeTenant(tenant);
  requireTenantScope(scope);
  if (!(await getFlow(env, id, scope))) return "unknown-flow";
  const overlay = await env.DB.prepare(
    "SELECT 1 FROM tenant_flows WHERE tenant_id=? AND flow_id=?",
  )
    .bind(scope, id)
    .first();
  const variables = await env.DB.prepare(
    "SELECT 1 FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=? LIMIT 1",
  )
    .bind(scope, id)
    .first();
  if (!overlay && !variables) return "unchanged";
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM tenant_flows WHERE tenant_id=? AND flow_id=?",
    ).bind(scope, id),
    env.DB.prepare(
      "DELETE FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=?",
    ).bind(scope, id),
  ]);
  return "reverted";
}

/**
 * Reverts a single variable override back to the platform default by
 * removing its overlay row.
 */
export async function resetVariable(
  env: Env,
  id: string,
  key: string,
  tenant: string,
): Promise<ResetStatus> {
  const scope = scopeTenant(tenant);
  requireTenantScope(scope);
  if (!(await getFlow(env, id, scope))) return "unknown-flow";
  const base = await baseVariables(env, id);
  const overlay = await overlayVariables(env, scope, id);
  if (
    !base.some((row) => row.key === key) &&
    !overlay.some((row) => row.key === key)
  )
    return "unknown-key";
  if (!overlay.some((row) => row.key === key)) return "unchanged";
  await env.DB.prepare(
    "DELETE FROM tenant_flow_variables WHERE tenant_id=? AND flow_id=? AND key=?",
  )
    .bind(scope, id, key)
    .run();
  return "reverted";
}

/** Duplicates an effective flow inside the same scope. */
export async function duplicateFlow(
  env: Env,
  sourceId: string,
  tenant = "",
): Promise<{ id: string; name: string } | null> {
  const scope = scopeTenant(tenant);
  const source = await getFlow(env, sourceId, scope);
  if (!source) return null;
  const id = "request-" + crypto.randomUUID();
  const copy = {
    ...source,
    id,
    name: source.name + " (copia)",
    steps: source.steps.map((step) => ({ ...step, id: crypto.randomUUID() })),
  };
  if (isPlatformTenant(scope)) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO flows(id,definition) VALUES(?,?)").bind(
        id,
        JSON.stringify(copy),
      ),
      env.DB.prepare(
        "INSERT INTO flow_variables(flow_id,key,value,secret) SELECT ?,key,value,secret FROM flow_variables WHERE flow_id=?",
      ).bind(id, source.id),
    ]);
    return { id, name: copy.name };
  }
  // Tenant copy: overlay rows move verbatim; non-secret platform defaults are
  // materialized so the copy is self-contained. Platform secrets are never
  // readable here, so they must be reconfigured on the copy.
  const base = await baseVariables(env, source.id);
  const overlay = await overlayVariables(env, scope, source.id);
  const overlayKeys = new Set(overlay.map((row) => row.key));
  const batch = [
    env.DB.prepare(
      "INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES(?,?,?,?)",
    ).bind(scope, id, JSON.stringify({ ...copy, variables: [] }), nowIso()),
    ...overlay.map((row) =>
      env.DB.prepare(
        "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?)",
      ).bind(scope, id, row.key, row.value, row.secret, nowIso()),
    ),
    ...base
      .filter((row) => !overlayKeys.has(row.key) && !row.secret)
      .map((row) =>
        env.DB.prepare(
          "INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES(?,?,?,?,?,?)",
        ).bind(scope, id, row.key, row.value, 0, nowIso()),
      ),
  ];
  await env.DB.batch(batch);
  return { id, name: copy.name };
}

export async function listFolders(env: Env, tenant = ""): Promise<string[]> {
  const scope = scopeTenant(tenant);
  const globals = await env.DB.prepare(
    "SELECT path FROM folders ORDER BY path",
  ).all<{ path: string }>();
  if (isPlatformTenant(scope)) return globals.results.map((r) => r.path);
  const overlays = await env.DB.prepare(
    "SELECT path FROM tenant_folders WHERE tenant_id=? ORDER BY path",
  )
    .bind(scope)
    .all<{ path: string }>();
  return [
    ...new Set([...globals.results, ...overlays.results].map((r) => r.path)),
  ].sort();
}

export async function folderExists(
  env: Env,
  path: string,
  tenant = "",
): Promise<boolean> {
  const scope = scopeTenant(tenant);
  if (
    await env.DB.prepare("SELECT path FROM folders WHERE path=?")
      .bind(path)
      .first()
  )
    return true;
  if (isPlatformTenant(scope)) return false;
  return Boolean(
    await env.DB.prepare(
      "SELECT path FROM tenant_folders WHERE tenant_id=? AND path=?",
    )
      .bind(scope, path)
      .first(),
  );
}

export async function createFolder(
  env: Env,
  path: string,
  tenant = "",
): Promise<void> {
  const scope = scopeTenant(tenant);
  const parts = path.split("/");
  if (isPlatformTenant(scope)) {
    await env.DB.batch(
      parts.map((_, index) =>
        env.DB.prepare(
          dialectFor(env.DB).name === "postgres"
            ? "INSERT INTO folders(path) VALUES(?) ON CONFLICT (path) DO NOTHING"
            : "INSERT OR IGNORE INTO folders(path) VALUES(?)",
        ).bind(parts.slice(0, index + 1).join("/")),
      ),
    );
    return;
  }
  await env.DB.batch(
    parts.map((_, index) =>
      env.DB.prepare(
        dialectFor(env.DB).name === "postgres"
          ? "INSERT INTO tenant_folders(tenant_id,path) VALUES(?,?) ON CONFLICT (tenant_id,path) DO NOTHING"
          : "INSERT OR IGNORE INTO tenant_folders(tenant_id,path) VALUES(?,?)",
      ).bind(scope, parts.slice(0, index + 1).join("/")),
    ),
  );
}

export async function deleteFolder(
  env: Env,
  path: string,
  tenant = "",
): Promise<void> {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope)) {
    await env.DB.prepare(
      "DELETE FROM folders WHERE path=? OR substr(path,1,length(?)+1)=?",
    )
      .bind(path, path, path + "/")
      .run();
    return;
  }
  await env.DB.prepare(
    "DELETE FROM tenant_folders WHERE tenant_id=? AND (path=? OR substr(path,1,length(?)+1)=?)",
  )
    .bind(scope, path, path, path + "/")
    .run();
}

export type VersionRow = { id: string; created_at: string };

export async function listVersions(
  env: Env,
  flowId: string,
  tenant = "",
): Promise<VersionRow[]> {
  const scope = scopeTenant(tenant);
  const globals = await env.DB.prepare(
    "SELECT id,created_at FROM flow_versions WHERE flow_id=? ORDER BY created_at DESC",
  )
    .bind(flowId)
    .all<VersionRow>();
  if (isPlatformTenant(scope)) return globals.results;
  const overlays = await env.DB.prepare(
    "SELECT id,created_at FROM tenant_flow_versions WHERE tenant_id=? AND flow_id=? ORDER BY created_at DESC",
  )
    .bind(scope, flowId)
    .all<VersionRow>();
  return [...overlays.results, ...globals.results].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

export async function publishFlow(
  env: Env,
  flowId: string,
  tenant = "",
): Promise<{ id: string } | null> {
  const scope = scopeTenant(tenant);
  const flow = await getFlow(env, flowId, scope);
  if (!flow) return null;
  const id = crypto.randomUUID();
  if (isPlatformTenant(scope)) {
    await env.DB.prepare(
      "INSERT INTO flow_versions(id,flow_id,definition,created_at) VALUES(?,?,?,?)",
    )
      .bind(id, flow.id, JSON.stringify(flow), nowIso())
      .run();
    return { id };
  }
  await env.DB.prepare(
    "INSERT INTO tenant_flow_versions(id,tenant_id,flow_id,definition,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(id, scope, flow.id, JSON.stringify(flow), nowIso())
    .run();
  return { id };
}

export type ResolvedVersion = { id: string | null; definition: string } | null;

/** Tenant versions win; otherwise the latest platform version applies. */
export async function resolveVersion(
  env: Env,
  flowId: string,
  versionId: string | undefined,
  tenant = "",
): Promise<ResolvedVersion> {
  const scope = scopeTenant(tenant);
  if (versionId) {
    if (!isPlatformTenant(scope)) {
      const overlay = await env.DB.prepare(
        "SELECT id,definition FROM tenant_flow_versions WHERE tenant_id=? AND flow_id=? AND id=?",
      )
        .bind(scope, flowId, versionId)
        .first<{ id: string; definition: string }>();
      if (overlay) return overlay;
    }
    const row = await env.DB.prepare(
      "SELECT id,definition FROM flow_versions WHERE id=? AND flow_id=?",
    )
      .bind(versionId, flowId)
      .first<{ id: string; definition: string }>();
    return row;
  }
  if (!isPlatformTenant(scope)) {
    const overlay = await env.DB.prepare(
      "SELECT id,definition FROM tenant_flow_versions WHERE tenant_id=? AND flow_id=? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(scope, flowId)
      .first<{ id: string; definition: string }>();
    if (overlay) return overlay;
  }
  const row = await env.DB.prepare(
    "SELECT id,definition FROM flow_versions WHERE flow_id=? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(flowId)
    .first<{ id: string; definition: string }>();
  return row;
}

export async function getVersionDefinition(
  env: Env,
  flowId: string,
  versionId: string,
  tenant = "",
): Promise<string | null> {
  const scope = scopeTenant(tenant);
  if (!isPlatformTenant(scope)) {
    const overlay = await env.DB.prepare(
      "SELECT definition FROM tenant_flow_versions WHERE tenant_id=? AND flow_id=? AND id=?",
    )
      .bind(scope, flowId, versionId)
      .first<{ definition: string }>();
    if (overlay) return overlay.definition;
  }
  const row = await env.DB.prepare(
    "SELECT definition FROM flow_versions WHERE flow_id=? AND id=?",
  )
    .bind(flowId, versionId)
    .first<{ definition: string }>();
  return row?.definition ?? null;
}

export async function createRun(
  env: Env,
  run: Run,
  tenant = "",
): Promise<void> {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope)) {
    await env.DB.prepare(
      "INSERT INTO flow_runs(id,flow_id,version_id,mode,status,created_at,summary) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        run.id,
        run.flowId,
        run.versionId,
        run.mode,
        run.status,
        run.createdAt,
        JSON.stringify(run),
      )
      .run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO tenant_flow_runs(id,tenant_id,flow_id,version_id,mode,status,created_at,summary) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      run.id,
      scope,
      run.flowId,
      run.versionId,
      run.mode,
      run.status,
      run.createdAt,
      JSON.stringify(run),
    )
    .run();
}

export async function persistRun(
  env: Env,
  run: Run,
  tenant = "",
): Promise<void> {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope)) {
    await env.DB.prepare("UPDATE flow_runs SET status=?,summary=? WHERE id=?")
      .bind(run.status, JSON.stringify(run), run.id)
      .run();
    return;
  }
  await env.DB.prepare(
    "UPDATE tenant_flow_runs SET status=?,summary=? WHERE tenant_id=? AND id=?",
  )
    .bind(run.status, JSON.stringify(run), scope, run.id)
    .run();
}

export async function listRuns(
  env: Env,
  flowId: string,
  tenant = "",
): Promise<Run[]> {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope)) {
    const rows = await env.DB.prepare(
      "SELECT summary FROM flow_runs WHERE flow_id=? ORDER BY created_at DESC LIMIT 20",
    )
      .bind(flowId)
      .all<{ summary: string }>();
    return rows.results.map((row) => JSON.parse(row.summary) as Run);
  }
  const rows = await env.DB.prepare(
    "SELECT summary FROM tenant_flow_runs WHERE tenant_id=? AND flow_id=? ORDER BY created_at DESC LIMIT 20",
  )
    .bind(scope, flowId)
    .all<{ summary: string }>();
  return rows.results.map((row) => JSON.parse(row.summary) as Run);
}

export async function getRun(
  env: Env,
  flowId: string,
  runId: string,
  tenant = "",
): Promise<{ summary: string; version_id: string | null } | null> {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope)) {
    return env.DB.prepare(
      "SELECT summary,version_id FROM flow_runs WHERE flow_id=? AND id=?",
    )
      .bind(flowId, runId)
      .first<{ summary: string; version_id: string | null }>();
  }
  return env.DB.prepare(
    "SELECT summary,version_id FROM tenant_flow_runs WHERE tenant_id=? AND flow_id=? AND id=?",
  )
    .bind(scope, flowId, runId)
    .first<{ summary: string; version_id: string | null }>();
}

/**
 * Removes every tenant overlay row so a deleted tenant leaves no flows,
 * variables (including sealed secrets), versions, runs, folders or bundle
 * markers behind. The platform catalog is never touched: purging "" throws.
 */
export async function purgeTenant(
  env: Env,
  tenant: string,
): Promise<Record<string, number>> {
  const scope = scopeTenant(tenant);
  if (isPlatformTenant(scope))
    throw new Error("El catálogo de plataforma no se puede purgar.");
  const purged: Record<string, number> = {};
  const tables: Array<[string, string]> = [
    ["variables", "DELETE FROM tenant_flow_variables WHERE tenant_id=?"],
    ["versions", "DELETE FROM tenant_flow_versions WHERE tenant_id=?"],
    ["runs", "DELETE FROM tenant_flow_runs WHERE tenant_id=?"],
    ["folders", "DELETE FROM tenant_folders WHERE tenant_id=?"],
    ["bundles", "DELETE FROM tenant_bundles WHERE tenant_id=?"],
    ["flows", "DELETE FROM tenant_flows WHERE tenant_id=?"],
  ];
  for (const [key, sql] of tables) {
    const result = await env.DB.prepare(sql).bind(scope).run();
    purged[key] = result.meta?.changes ?? 0;
  }
  return purged;
}

export type AuditAction =
  | "flow.save"
  | "flow.delete"
  | "flow.duplicate"
  | "flow.publish"
  | "flow.reset"
  | "variables.save"
  | "variables.import"
  | "variable.reveal"
  | "variable.reset"
  | "folder.create"
  | "folder.delete"
  | "bundle.ensure"
  | "bundle.sync"
  | "tenant.purge";

export type AuditEvent = {
  id: string;
  tenant: string;
  actor: string;
  action: AuditAction;
  flowId: string | null;
  detail: unknown;
  createdAt: string;
};

/**
 * Best-effort audit trail: who changed what, per scope. Never throws, so a
 * logging failure can't break the operation it describes. Secret VALUES are
 * never recorded, only keys and counts. Reads (except secret reveals) and
 * flow executions (already in flow_runs) are not logged.
 */
export async function recordAudit(
  env: Env,
  event: {
    tenant?: string;
    actor?: string;
    action: AuditAction;
    flowId?: string | null;
    detail?: unknown;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO savia_request_audit(id,tenant_id,actor,action,flow_id,detail,created_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        scopeTenant(event.tenant ?? ""),
        String(event.actor ?? "").slice(0, 200),
        event.action,
        event.flowId ?? null,
        event.detail === undefined ? null : JSON.stringify(event.detail),
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    console.error(
      "audit write failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

function parseAuditCursor(
  cursor: string | undefined,
): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf("|");
  if (separator < 0) return null;
  const createdAt = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!createdAt || !id || id.length > 80) return null;
  return { createdAt, id };
}

export async function listAuditEvents(
  env: Env,
  tenant = "",
  input: { limit?: number; cursor?: string } = {},
): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const scope = scopeTenant(tenant);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50) || 50, 1), 200);
  const cursor = parseAuditCursor(input.cursor);
  const rows = cursor
    ? await env.DB.prepare(
        "SELECT id,tenant_id,actor,action,flow_id,detail,created_at FROM savia_request_audit WHERE tenant_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
      )
        .bind(scope, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
        .all<{
          id: string;
          tenant_id: string;
          actor: string;
          action: AuditAction;
          flow_id: string | null;
          detail: string | null;
          created_at: string;
        }>()
    : await env.DB.prepare(
        "SELECT id,tenant_id,actor,action,flow_id,detail,created_at FROM savia_request_audit WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
      )
        .bind(scope, limit + 1)
        .all<{
          id: string;
          tenant_id: string;
          actor: string;
          action: AuditAction;
          flow_id: string | null;
          detail: string | null;
          created_at: string;
        }>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    events: page.map((row) => ({
      id: row.id,
      tenant: row.tenant_id,
      actor: row.actor,
      action: row.action,
      flowId: row.flow_id,
      detail: row.detail === null ? null : JSON.parse(row.detail),
      createdAt: row.created_at,
    })),
    nextCursor:
      rows.results.length > limit && last
        ? `${last.created_at}|${last.id}`
        : null,
  };
}
