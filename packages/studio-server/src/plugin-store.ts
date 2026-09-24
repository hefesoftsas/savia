import {
  PLUGIN_STORE_CONFIG_PATH,
  PLUGIN_STORE_ENTRY_PATH,
  PLUGIN_STORE_MANIFEST_PATH,
  PLUGIN_STORE_MAX_ZIP_BYTES,
  assertStoreHttpUrl,
  pluginStoreManifestSchema,
  redactSecrets,
  renderTemplate,
  sanitizeStoreCollection,
  storeJsonSchema,
  storeMcpActions,
  validatePluginEntrySource,
  type PluginStoreManifest,
  type StoreCollection,
  type StoreConnector,
  type StoreHttpAction,
  type StoreJson,
} from "@savia/crm-shared/plugin-store";
import {
  canonicalJson,
  compareSolutionVersions,
} from "@savia/crm-shared/solution-package";
import type { ExtensionObjectRequirement } from "@savia/crm-shared/extension-package";
import type { ExtensionConnectorDefinition } from "@savia/crm-shared/extension-runtime";
import { z } from "zod";
import { type Env, fail } from "./context";
import { audit } from "./services";
import type { Hono } from "hono";

export type PluginStoreOptions = {
  canManageExtension?: (input: {
    tenantId: string;
    principalId: string;
    extensionId: string;
  }) => Promise<boolean> | boolean;
};

/** Cuotas por tenant: 10 versiones por plugin, 20 MB agregados. */
export const PLUGIN_STORE_MAX_VERSIONS_PER_ID = 10;
export const PLUGIN_STORE_MAX_BYTES_PER_TENANT = 20 * 1024 * 1024;

async function assertStoreQuota(
  db: D1Database,
  tenant: string,
  pluginId: string,
  sizeBytes: number,
): Promise<void> {
  const usage = await db
    .prepare(
      `SELECT coalesce(sum(case when id=? then 1 else 0 end),0) as plugin_versions,
              coalesce(sum(size_bytes),0) as total_bytes
       FROM plugin_store_artifacts WHERE tenant_id=?`,
    )
    .bind(pluginId, tenant)
    .first<{ plugin_versions: number; total_bytes: number }>();
  if (!usage) return;
  if (usage.plugin_versions >= PLUGIN_STORE_MAX_VERSIONS_PER_ID)
    fail(
      `El plugin ya tiene ${PLUGIN_STORE_MAX_VERSIONS_PER_ID} versiones. Elimina alguna antes de subir otra.`,
      409,
    );
  if (usage.total_bytes + sizeBytes > PLUGIN_STORE_MAX_BYTES_PER_TENANT)
    fail("El espacio alcanzó la cuota de 20 MB del store.", 413);
}

export type ParsedStoreZip = {
  manifest: PluginStoreManifest;
  entryJs: string;
  store: StoreJson | null;
  sha256: string;
  sizeBytes: number;
};

// --- Lector ZIP mínimo (stored + deflated) sobre APIs del Worker ---

type ZipEntry = { name: string; method: number; data: Uint8Array };

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeAscii(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function findCentralDirectory(bytes: Uint8Array): number {
  // EOCD: busca la firma desde el final (sin comentario o con comentario).
  const view = dataView(bytes);
  const start = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("El ZIP no contiene un directorio central válido.");
}

async function inflateRaw(data: Uint8Array, name: string): Promise<Uint8Array> {
  try {
    // Copia: Blob ignora el byteOffset de algunas vistas en ciertos runtimes.
    const owned = data.slice();
    const stream = new Blob([owned as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    throw new Error(`No se pudo descomprimir ${name}.`);
  }
}

async function unzipEntries(bytes: Uint8Array): Promise<ZipEntry[]> {
  if (bytes.length < 22) throw new Error("El archivo no es un ZIP válido.");
  const view = dataView(bytes);
  const eocd = findCentralDirectory(bytes);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("El ZIP está corrupto.");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength);
    cursor += 46 + fileNameLength + extraLength + commentLength;

    const name = new TextDecoder().decode(nameBytes);
    if (name.endsWith("/")) continue; // directorio
    if (
      name.includes("..") ||
      name.startsWith("/") ||
      name.startsWith("\\") ||
      /[A-Z]:/.test(name)
    )
      throw new Error(`El ZIP contiene una ruta no permitida: ${name}.`);

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50)
      throw new Error("El ZIP está corrupto.");
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 0) entries.push({ name, method, data });
    else if (method === 8)
      entries.push({ name, method, data: await inflateRaw(data, name) });
    else throw new Error(`El ZIP usa un método no soportado en ${name}.`);
  }
  return entries;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function parsePluginStoreZip(
  bytes: Uint8Array,
): Promise<ParsedStoreZip> {
  if (bytes.length === 0) throw new Error("El archivo ZIP está vacío.");
  if (bytes.length > PLUGIN_STORE_MAX_ZIP_BYTES)
    throw new Error("El ZIP supera el máximo de 6 MB.");
  // Firma local de ZIP.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b))
    throw new Error("El archivo no es un ZIP válido.");

  const entries = await unzipEntries(bytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get(PLUGIN_STORE_MANIFEST_PATH);
  if (!manifestEntry)
    throw new Error("El ZIP debe incluir savia-extension.json en la raíz.");
  const entryFile = byName.get(PLUGIN_STORE_ENTRY_PATH);
  if (!entryFile)
    throw new Error("El ZIP debe incluir dist/plugin.js compilado.");

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch {
    throw new Error("savia-extension.json no contiene JSON válido.");
  }
  const manifest = pluginStoreManifestSchema.parse(manifestJson);
  const entryJs = new TextDecoder().decode(entryFile.data);
  validatePluginEntrySource(entryJs);
  const storeEntry = byName.get(PLUGIN_STORE_CONFIG_PATH);
  let store: StoreJson | null = null;
  if (storeEntry) {
    try {
      store = storeJsonSchema.parse(
        JSON.parse(new TextDecoder().decode(storeEntry.data)),
      );
    } catch {
      throw new Error("store.json no cumple el contrato savia.store v1.");
    }
  }
  return {
    manifest,
    entryJs,
    store,
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
  };
}

// --- Acceso a D1 ---

export type StoreArtifactRow = {
  id: string;
  version: string;
  manifest: string;
  store_json?: string | null;
  sha256: string;
  size_bytes: number;
  created_by: string | null;
  created_at: string;
};

/**
 * Requisitos de colección declarados por un plugin del store, listos
 * para `prepareExtensionObjectProvisioning`. Entradas corruptas se
 * ignoran (la subida ya validó el contrato).
 */
export async function storeObjectRequirements(
  db: D1Database,
  tenant: string,
  extensionId: string,
): Promise<ExtensionObjectRequirement[]> {
  const config = await storeConfigFor(db, tenant, extensionId);
  if (!config) return [];
  const requirements: ExtensionObjectRequirement[] = [];
  for (const collection of config.collections ?? []) {
    try {
      const sanitized = sanitizeStoreCollection(collection as StoreCollection);
      requirements.push({ id: extensionId, ...sanitized });
    } catch {
      // Se ignora: la subida validó; ante corrupción no se provisiona.
    }
  }
  return requirements;
}

/** Resumen declarativo para la UI (conectores, acciones, ajustes). */
function storeDeclarations(storeJson: string | null | undefined) {
  const empty = {
    actions: [],
    connectors: [],
    collections: [],
    hasSettings: false,
  };
  try {
    if (!storeJson) return empty;
    const config = storeJsonSchema.parse(JSON.parse(storeJson));
    return {
      actions: config.actions.map((action) => ({
        id: action.id,
        kind: action.kind,
      })),
      connectors: config.connectors.map((connector) => ({
        id: connector.id,
        label: connector.label,
        fields: Object.entries(connector.configSchema.properties).map(
          ([name, field]) => ({
            name,
            type: field.type,
            required: connector.configSchema.required.includes(name),
            secret: connector.secretFields.includes(name),
          }),
        ),
      })),
      collections: (config.collections ?? [])
        .map((collection) => {
          const object = collection.object as { name?: unknown } | null;
          return typeof object?.name === "string" ? object.name : null;
        })
        .filter((name): name is string => name !== null),
      hasSettings: config.settings !== undefined,
    };
  } catch {
    return empty;
  }
}

async function storeTableExists(db: D1Database): Promise<boolean> {
  try {
    await db.prepare("SELECT 1 FROM plugin_store_artifacts LIMIT 1").first();
    return true;
  } catch {
    return false;
  }
}

/** Última versión por id con comparación semver (MAX() miente con 1.10.0). */
function latestById(
  rows: ReadonlyArray<{ id: string; version: string }>,
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    const current = latest.get(row.id);
    if (
      current === undefined ||
      compareSolutionVersions(row.version, current) > 0
    )
      latest.set(row.id, row.version);
  }
  return latest;
}

/** Manifiestos del store del tenant (última versión por id). */
export async function storePluginCatalog(
  db: D1Database,
  tenant: string,
): Promise<PluginStoreManifest[]> {
  if (!(await storeTableExists(db))) return [];
  const rows = await db
    .prepare(
      "SELECT id,version,manifest FROM plugin_store_artifacts WHERE tenant_id=?",
    )
    .bind(tenant)
    .all<{ id: string; version: string; manifest: string }>();
  const latest = latestById(rows.results);
  const catalog: PluginStoreManifest[] = [];
  for (const row of rows.results) {
    if (latest.get(row.id) !== row.version) continue;
    try {
      catalog.push(pluginStoreManifestSchema.parse(JSON.parse(row.manifest)));
    } catch {
      // Artefacto corrupto: se ignora en el catálogo, sigue listado en el store.
    }
  }
  return catalog;
}

async function latestArtifactRow<T>(
  db: D1Database,
  tenant: string,
  id: string,
  columns: string,
): Promise<(T & { version: string }) | null> {
  const rows = await db
    .prepare(
      `SELECT ${columns} FROM plugin_store_artifacts WHERE tenant_id=? AND id=?`,
    )
    .bind(tenant, id)
    .all<T & { version: string }>();
  let best: (T & { version: string }) | null = null;
  for (const row of rows.results) {
    if (best === null || compareSolutionVersions(row.version, best.version) > 0)
      best = row;
  }
  return best;
}

export async function storePluginManifest(
  db: D1Database,
  tenant: string,
  id: string,
): Promise<PluginStoreManifest | null> {
  if (!(await storeTableExists(db))) return null;
  const row = await latestArtifactRow<{ manifest: string }>(
    db,
    tenant,
    id,
    "version,manifest",
  );
  if (!row) return null;
  try {
    return pluginStoreManifestSchema.parse(JSON.parse(row.manifest));
  } catch {
    return null;
  }
}

async function storeEntryJs(
  db: D1Database,
  tenant: string,
  id: string,
  version: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT entry_js FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=?",
    )
    .bind(tenant, id, version)
    .first<{ entry_js: string }>();
  return row?.entry_js ?? null;
}

/**
 * Configuración declarativa (`store.json`) del artefacto más reciente.
 * Devuelve null si la tabla/columna no existe o el plugin no declara una.
 */
export async function storeConfigFor(
  db: D1Database,
  tenant: string,
  id: string,
): Promise<StoreJson | null> {
  try {
    const row = await latestArtifactRow<{ store_json: string | null }>(
      db,
      tenant,
      id,
      "version,store_json",
    );
    if (!row?.store_json) return null;
    return storeJsonSchema.parse(JSON.parse(row.store_json));
  } catch {
    return null;
  }
}

function zodFieldFromJson(
  field: StoreConnector["configSchema"]["properties"][string],
): z.ZodTypeAny {
  let schema: z.ZodTypeAny =
    field.type === "string"
      ? z.string()
      : field.type === "number"
        ? z.number()
        : z.boolean();
  if (field.enum?.length) {
    const literals = field.enum.map((option) =>
      typeof option === "string"
        ? z.literal(option)
        : typeof option === "number"
          ? z.literal(option)
          : z.literal(option as boolean),
    ) as unknown as [z.ZodTypeAny, ...z.ZodTypeAny[]];
    schema = z.union(literals);
  }
  return schema;
}

/** Definición de conector del store compatible con el repositorio. */
export async function storeConnectorDefinition(
  db: D1Database,
  tenant: string,
  extensionId: string,
  connectorId: string,
): Promise<ExtensionConnectorDefinition | null> {
  const config = await storeConfigFor(db, tenant, extensionId);
  const connector = config?.connectors.find((item) => item.id === connectorId);
  if (!connector) return null;
  const required = new Set(connector.configSchema.required);
  return {
    extensionId,
    connectorId: connector.id,
    label: connector.label,
    configurationSchema: z
      .object(
        Object.fromEntries(
          Object.entries(connector.configSchema.properties).map(
            ([name, field]) => [
              name,
              required.has(name)
                ? zodFieldFromJson(field)
                : zodFieldFromJson(field).optional(),
            ],
          ),
        ),
      )
      .strict(),
    secretFields: connector.secretFields,
  };
}

export class StoreHttpInputError extends Error {}
export class StoreHttpProviderError extends Error {}

const STORE_HTTP_TIMEOUT_MS = 20000;
const STORE_HTTP_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Ejecuta una acción http declarativa con valores ya revelados. */
export async function executeStoreHttpAction(input: {
  action: StoreHttpAction;
  connector: Pick<
    StoreConnector,
    "allowedHosts" | "allowConfiguredHost" | "secretFields"
  >;
  values: Record<string, unknown>;
  actionInput: Record<string, unknown>;
  context: {
    tenantId: string;
    principalId: string;
    extensionId: string;
    actionId: string;
    runId: string;
  };
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const scopes = {
    input: input.actionInput,
    connection: input.values,
    tenant: input.context.tenantId,
    principal: input.context.principalId,
    extension: input.context.extensionId,
    action: input.context.actionId,
    run: input.context.runId,
  };
  const renderedUrl = renderTemplate(input.action.request.url, scopes);
  if (typeof renderedUrl !== "string" || !renderedUrl.trim())
    throw new StoreHttpInputError("La plantilla no produjo una URL válida.");
  const allowedHosts = [...input.connector.allowedHosts];
  if (input.connector.allowConfiguredHost) {
    const endpoint = input.values["endpoint"];
    if (typeof endpoint !== "string" || !endpoint.trim())
      throw new StoreHttpInputError("La conexión no define endpoint.");
    let configured: URL;
    try {
      configured = new URL(endpoint.trim());
    } catch {
      throw new StoreHttpInputError("El endpoint configurado no es válido.");
    }
    if (
      configured.protocol !== "https:" ||
      configured.username ||
      configured.password ||
      configured.hostname === "169.254.169.254" ||
      configured.hostname === "100.100.100.200"
    )
      throw new StoreHttpInputError(
        "El endpoint configurado no está permitido.",
      );
    allowedHosts.push(configured.hostname.toLowerCase());
  }
  let url: URL;
  try {
    url = assertStoreHttpUrl(renderedUrl.trim(), allowedHosts);
  } catch (error) {
    throw new StoreHttpInputError(
      error instanceof Error ? error.message : "La URL no está permitida.",
    );
  }
  const headers: Record<string, string> = {};
  for (const [name, template] of Object.entries(input.action.request.headers)) {
    const rendered = renderTemplate(template, scopes);
    if (typeof rendered !== "string")
      throw new StoreHttpInputError(`La cabecera ${name} no es texto.`);
    headers[name] = rendered;
  }
  const renderedBody =
    input.action.request.method === "GET" ||
    input.action.request.method === "HEAD"
      ? undefined
      : renderTemplate(input.action.request.body ?? null, scopes);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url.toString(), {
      method: input.action.request.method,
      headers,
      body:
        renderedBody === undefined || renderedBody === null
          ? undefined
          : JSON.stringify(renderedBody),
      redirect: "manual",
      signal: AbortSignal.timeout(STORE_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof StoreHttpInputError) throw error;
    throw new StoreHttpProviderError("No se pudo contactar al proveedor.");
  }
  const raw = await response.text();
  if (raw.length > STORE_HTTP_MAX_RESPONSE_BYTES)
    throw new StoreHttpProviderError(
      "La respuesta del proveedor es muy grande.",
    );
  if (!response.ok)
    throw new StoreHttpProviderError(
      `El proveedor rechazó la solicitud (HTTP ${response.status}).`,
    );
  const contentType = response.headers.get("content-type") ?? "";
  let data: unknown = raw;
  if (contentType.includes("json")) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new StoreHttpProviderError("El proveedor devolvió JSON inválido.");
    }
  }
  const secrets = input.connector.secretFields.flatMap((field) => {
    const value = input.values[field];
    return typeof value === "string" && value ? [value] : [];
  });
  for (const secret of secrets) {
    if (secret.length >= 8 && raw.includes(secret))
      throw new StoreHttpProviderError(
        "El proveedor reflejó un secreto en la respuesta.",
      );
  }
  return { status: response.status, data: redactSecrets(data, secrets) };
}

async function assertCanManage(
  tenant: string,
  principalId: string,
  options: PluginStoreOptions,
  extensionId: string,
): Promise<void> {
  if (!options.canManageExtension) return;
  const allowed = await options.canManageExtension({
    tenantId: tenant,
    principalId: principalId,
    extensionId,
  });
  if (!allowed) fail("Se requiere permiso de administración del espacio.", 403);
}

// --- Shell del sandbox ---
//
// El bootstrap vive en un archivo externo (`shell-bootstrap.js`) para que
// la CSP pueda prohibir `unsafe-inline`/`unsafe-eval`: ni eval(), ni
// new Function(), ni setTimeout("código") ejecutan aunque eludan la
// validación estática. El puente savia sigue siendo postMessage.

const SHELL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';";

export function shellBootstrapPath(pluginId: string, entryUrl: string): string {
  const params = new URLSearchParams({ plugin: pluginId, entry: entryUrl });
  return `/api/plugin-store/shell-bootstrap.js?${params}`;
}

export function shellBootstrapJs(): string {
  return `const params = new URL(import.meta.url).searchParams;
const PLUGIN_ID = params.get("plugin") ?? "unknown";
const ENTRY_URL = params.get("entry") ?? "";
if (!/^https?:\\/\\/[^/]+\\/api\\/plugin-store\\//.test(ENTRY_URL))
  throw new Error("URL de entrada no válida.");
const pending = new Map();
let seq = 0;
function callHost(path, method, body) {
  return new Promise((resolve, reject) => {
    const id = String(++seq);
    pending.set(id, { resolve, reject });
    parent.postMessage({ ns: "savia-plugin", type: "request", id, path, method, body }, "*");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("El host no respondió a tiempo."));
      }
    }, 30000);
  });
}
addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.ns !== "savia-plugin" || message.type !== "response") return;
  const slot = pending.get(message.id);
  if (!slot) return;
  pending.delete(message.id);
  if (message.ok) slot.resolve(message.data);
  else slot.reject(new Error(message.error || "Error del host."));
});
function collection(name) {
  const resource = encodeURIComponent(name);
  return {
    async list(options = {}) {
      const params = new URLSearchParams({
        page: String(options.page ?? 1),
        perPage: String(options.perPage ?? 25),
        sort: options.sort ?? "updated_at",
        order: options.order ?? "DESC",
      });
      return callHost("/records/" + resource + "?" + params, "GET");
    },
    async get(id) {
      return (await callHost("/records/" + resource + "/" + encodeURIComponent(id), "GET")).data;
    },
    async create(input) {
      return (await callHost("/records/" + resource, "POST", input)).data;
    },
    async update(id, input, update = {}) {
      return (await callHost("/records/" + resource + "/" + encodeURIComponent(id), "PATCH",
        update.version === undefined ? input : { ...input, _version: update.version })).data;
    },
    async remove(id, update = {}) {
      const params = new URLSearchParams();
      if (update.version !== undefined) params.set("version", String(update.version));
      const suffix = params.size ? "?" + params : "";
      await callHost("/records/" + resource + "/" + encodeURIComponent(id) + suffix, "DELETE");
    },
    async describe() {
      return (await callHost("/objects", "GET")).data.find((c) => c.name === name);
    },
  };
}
const extensionPath = "/extensions/" + encodeURIComponent(PLUGIN_ID);
const savia = {
  pluginId: PLUGIN_ID,
  collections: {
    async list() {
      return (await callHost("/objects", "GET")).data;
    },
    collection,
  },
  settings: {
    async get() {
      return (await callHost(extensionPath + "/settings", "GET")).data;
    },
    async replace(value, version) {
      return (await callHost(extensionPath + "/settings", "PUT", { value, version })).data;
    },
  },
  connections: {
    async list() {
      return (await callHost(extensionPath + "/connections", "GET")).data;
    },
    async replace(connectionId, value) {
      await callHost(extensionPath + "/connections/" + encodeURIComponent(connectionId), "PUT", value);
    },
    async remove(connectionId) {
      await callHost(extensionPath + "/connections/" + encodeURIComponent(connectionId), "DELETE");
    },
  },
  actions: {
    async execute(actionId, input) {
      return (await callHost(extensionPath + "/actions/" + encodeURIComponent(actionId), "POST", input)).data;
    },
    async list(options = {}) {
      const limit = Math.min(100, Math.max(1, options.limit ?? 20));
      return (await callHost(extensionPath + "/actions/runs?limit=" + limit, "GET")).data;
    },
  },
  access: {
    async effective() {
      return (await callHost("/access-context", "GET")).data;
    },
  },
};
// Sin red directa en el sandbox: las lecturas relativas al host
// (/api/lookups/*, /api/geocoding/*, ...) se redirigen al padre,
// que las ejecuta con la sesión actual si están permitidas.
const nativeFetch = window.fetch.bind(window);
window.fetch = (resource, init) => {
  const url = typeof resource === "string" ? resource : resource.url;
  if (url.startsWith("/api/")) {
    const method = (init && init.method) || "GET";
    let body;
    if (init && init.body !== undefined && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = undefined; }
    }
    return callHost(url.slice("/api".length), method, body).then((data) =>
      Response.json(data, { status: 200 }),
    );
  }
  return nativeFetch(resource, init);
};
try {
  const module = await import(ENTRY_URL);
  const render = module.render ?? module.default?.render ?? module.default;
  if (typeof render !== "function") throw new Error("El plugin debe exportar render(element, savia).");
  await render(document.getElementById("root"), savia);
  parent.postMessage({ ns: "savia-plugin", type: "ready" }, "*");
} catch (error) {
  document.getElementById("root").innerHTML =
    '<p class="plugin-error">' + String((error && error.message) || error) + "</p>";
  parent.postMessage({ ns: "savia-plugin", type: "error", error: String((error && error.message) || error) }, "*");
}`;
}

function shellHtml(pluginId: string, label: string, entryUrl: string): string {
  const safeLabel = label.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${SHELL_CSP}">
<title>${safeLabel}</title>
<style>body{margin:0;font-family:system-ui,sans-serif}#root{padding:16px}.plugin-error{color:#b91c1c;white-space:pre-wrap}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="${shellBootstrapPath(pluginId, entryUrl)}"></script>
</body>
</html>`;
}

// --- Rutas ---

export function registerPluginStore(
  app: Hono<Env>,
  options: PluginStoreOptions = {},
) {
  app.get("/api/plugin-store", async (c) => {
    const tenant = c.get("tenant");
    if (!(await storeTableExists(c.env.DB))) return c.json({ data: [] });
    let rows: StoreArtifactRow[];
    try {
      rows = (
        await c.env.DB.prepare(
          `SELECT id,version,manifest,store_json,sha256,size_bytes,created_by,created_at
           FROM plugin_store_artifacts WHERE tenant_id=? ORDER BY id,version`,
        )
          .bind(tenant)
          .all<StoreArtifactRow & { store_json: string | null }>()
      ).results;
    } catch {
      rows = (
        await c.env.DB.prepare(
          `SELECT id,version,manifest,sha256,size_bytes,created_by,created_at
           FROM plugin_store_artifacts WHERE tenant_id=? ORDER BY id,version`,
        )
          .bind(tenant)
          .all<StoreArtifactRow>()
      ).results.map((row) => ({ ...row, store_json: null }));
    }
    const installed = await c.env.DB.prepare(
      "SELECT id,version,enabled FROM crm_extension_installations WHERE tenant_id=?",
    )
      .bind(tenant)
      .all<{ id: string; version: string; enabled: number }>();
    const state = new Map(installed.results.map((row) => [row.id, row]));
    return c.json({
      data: rows.map((row) => ({
        manifest: JSON.parse(row.manifest),
        version: row.version,
        sha256: row.sha256,
        sizeBytes: row.size_bytes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        declarations: storeDeclarations(row.store_json),
        installed: state.get(row.id)
          ? {
              version: state.get(row.id)!.version,
              enabled: state.get(row.id)!.enabled === 1,
            }
          : null,
      })),
    });
  });

  app.post("/api/plugin-store/upload", async (c) => {
    const tenant = c.get("tenant");
    if (!(await storeTableExists(c.env.DB)))
      return fail("El store de plugins no está migrado en este entorno.", 428);
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return fail("Sube un archivo ZIP.", 400);
    if (!/\.zip$/i.test(file.name))
      return fail("El archivo debe ser .zip.", 400);
    let parsed: ParsedStoreZip;
    try {
      parsed = await parsePluginStoreZip(
        new Uint8Array(await file.arrayBuffer()),
      );
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "El ZIP no es válido.",
        422,
      );
    }
    await assertCanManage(
      c.get("tenant"),
      c.get("principalId"),
      options,
      parsed.manifest.id,
    );
    const existing = await c.env.DB.prepare(
      "SELECT manifest FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=?",
    )
      .bind(tenant, parsed.manifest.id, parsed.manifest.version)
      .first<{ manifest: string }>();
    if (existing) {
      if (
        canonicalJson(JSON.parse(existing.manifest)) !==
        canonicalJson(parsed.manifest)
      )
        return fail(
          "Esta versión ya existe con otro contenido. Publica una versión nueva.",
          409,
        );
      return c.json({
        data: {
          id: parsed.manifest.id,
          version: parsed.manifest.version,
          sha256: parsed.sha256,
          deduped: true,
        },
      });
    }
    const principalId = c.get("principalId") || null;
    await assertStoreQuota(
      c.env.DB,
      tenant,
      parsed.manifest.id,
      parsed.sizeBytes,
    );
    let hasConfigColumn = true;
    try {
      await c.env.DB.prepare(
        "SELECT store_json FROM plugin_store_artifacts LIMIT 1",
      ).first();
    } catch {
      hasConfigColumn = false;
    }
    if (parsed.store && !hasConfigColumn)
      return fail(
        "Este entorno aún no soporta store.json (migración pendiente).",
        428,
      );
    if (hasConfigColumn) {
      await c.env.DB.prepare(
        `INSERT INTO plugin_store_artifacts(tenant_id,id,version,manifest,entry_js,store_json,sha256,size_bytes,created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          tenant,
          parsed.manifest.id,
          parsed.manifest.version,
          canonicalJson(parsed.manifest),
          parsed.entryJs,
          parsed.store ? canonicalJson(parsed.store) : null,
          parsed.sha256,
          parsed.sizeBytes,
          principalId,
        )
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO plugin_store_artifacts(tenant_id,id,version,manifest,entry_js,sha256,size_bytes,created_by)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
        .bind(
          tenant,
          parsed.manifest.id,
          parsed.manifest.version,
          canonicalJson(parsed.manifest),
          parsed.entryJs,
          parsed.sha256,
          parsed.sizeBytes,
          principalId,
        )
        .run();
    }
    await audit(
      c.env.DB,
      tenant,
      "plugin-store.uploaded",
      "plugin",
      parsed.manifest.id,
      { version: parsed.manifest.version, sha256: parsed.sha256 },
    )
      .run()
      .catch(() => undefined);
    return c.json({
      data: {
        id: parsed.manifest.id,
        version: parsed.manifest.version,
        sha256: parsed.sha256,
        deduped: false,
      },
    });
  });

  app.get("/api/plugin-store/shell-bootstrap.js", async (c) => {
    return new Response(shellBootstrapJs(), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "content-security-policy": "default-src 'none';",
      },
    });
  });

  // Catálogo para el asistente: solo plugins activos con acciones
  // de lectura declaradas, ya saneadas. Sin manager: es lectura del
  // propio tenant con la sesión actual.
  app.get("/api/plugin-store/mcp-catalog", async (c) => {
    const tenant = c.get("tenant");
    if (!(await storeTableExists(c.env.DB))) return c.json({ data: [] });
    const installed = await c.env.DB.prepare(
      "SELECT id,version,enabled,manifest FROM crm_extension_installations WHERE tenant_id=? AND enabled=1",
    )
      .bind(tenant)
      .all<{
        id: string;
        version: string;
        enabled: number;
        manifest: string;
      }>();
    const entries = [];
    for (const row of installed.results) {
      let manifest: PluginStoreManifest;
      try {
        manifest = pluginStoreManifestSchema.parse(JSON.parse(row.manifest));
      } catch {
        continue;
      }
      // Solo ids del store (custom.*): los compilados no tienen store.json.
      if (!manifest.id.startsWith("custom.")) continue;
      const config = await storeConfigFor(c.env.DB, tenant, row.id);
      if (!config) continue;
      const actions = storeMcpActions(row.id, config);
      if (!actions.length) continue;
      entries.push({ pluginId: row.id, label: manifest.label, actions });
    }
    return c.json({ data: entries });
  });

  app.get("/api/plugin-store/:id/entry", async (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const version = c.req.query("version");
    let resolvedVersion = version;
    if (!resolvedVersion) {
      const installed = await c.env.DB.prepare(
        "SELECT version FROM crm_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
      )
        .bind(tenant, id)
        .first<{ version: string }>();
      if (!installed)
        return fail("El plugin no está activo en este espacio.", 404);
      resolvedVersion = installed.version;
    }
    const entryJs = await storeEntryJs(c.env.DB, tenant, id, resolvedVersion);
    if (entryJs === null) return fail("Artefacto no encontrado.", 404);
    return new Response(entryJs, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "private, max-age=300",
        // El iframe opaco necesita CORS para importar el módulo.
        "access-control-allow-origin": "*",
        "content-security-policy": "default-src 'none';",
      },
    });
  });

  app.get("/api/plugin-store/:id/shell", async (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const installed = await c.env.DB.prepare(
      "SELECT version,manifest FROM crm_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
    )
      .bind(tenant, id)
      .first<{ version: string; manifest: string }>();
    if (!installed)
      return fail("El plugin no está activo en este espacio.", 404);
    const manifest = JSON.parse(installed.manifest) as { label?: string };
    const base = new URL(c.req.url);
    const entryUrl = `${base.origin}/api/plugin-store/${encodeURIComponent(id)}/entry?version=${encodeURIComponent(installed.version)}`;
    return new Response(shellHtml(id, manifest.label ?? id, entryUrl), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, max-age=60",
        "x-frame-options": "SAMEORIGIN",
      },
    });
  });

  app.delete("/api/plugin-store/:id", async (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const version = c.req.query("version");
    await assertCanManage(c.get("tenant"), c.get("principalId"), options, id);
    const active = await c.env.DB.prepare(
      "SELECT 1 FROM crm_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
    )
      .bind(tenant, id)
      .first();
    if (active)
      return fail("Desactiva el plugin antes de eliminar su artefacto.", 409);
    if (version) {
      await c.env.DB.prepare(
        "DELETE FROM plugin_store_artifacts WHERE tenant_id=? AND id=? AND version=?",
      )
        .bind(tenant, id, version)
        .run();
    } else {
      await c.env.DB.prepare(
        "DELETE FROM plugin_store_artifacts WHERE tenant_id=? AND id=?",
      )
        .bind(tenant, id)
        .run();
    }
    await c.env.DB.prepare(
      "DELETE FROM crm_extension_installations WHERE tenant_id=? AND id=?",
    )
      .bind(tenant, id)
      .run()
      .catch(() => undefined);
    return c.json({ data: { id, deleted: true } });
  });
}
