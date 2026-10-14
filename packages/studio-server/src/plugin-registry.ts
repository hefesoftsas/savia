import { compareSolutionVersions } from "@savia/studio-shared/solution-package";
import {
  pluginHeadSchema,
  type PluginHead,
} from "@savia/studio-shared/plugin-development";
import { z } from "zod";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Env, fail } from "./context";
import { PLUGIN_STORE_MAX_ZIP_BYTES } from "@savia/studio-shared/plugin-store";
import {
  parsePluginStoreZip,
  persistParsedStoreArtifact,
  type PluginStoreOptions,
  type ParsedStoreZip,
} from "./plugin-store";

const releaseSchema = z
  .object({
    id: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
    label: z.string().min(1).max(256),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(6 * 1024 * 1024),
    createdAt: z.string().min(1).max(64),
  })
  .strict();

const listSchema = z
  .object({
    data: z.array(releaseSchema).max(100),
    cursor: z.string().max(2048).nullable(),
  })
  .strict();

const importSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
    version: z
      .string()
      .regex(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
      ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const publishSchema = z
  .object({ data: releaseSchema, deduped: z.boolean() })
  .strict();

function registryBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid registry URL");
  }
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (!localHttp && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("invalid registry URL");
  if (url.pathname !== "/") throw new Error("invalid registry URL");
  return url;
}

async function fetchRegistry(url: URL, token: string): Promise<Response> {
  return fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

/** Delete one immutable release using only the dedicated publisher credential. */
export class PluginRegistryDeleteError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PluginRegistryDeleteError";
  }
}

export async function deletePluginRegistryRelease(
  config: NonNullable<PluginStoreOptions["pluginRegistry"]>,
  pluginId: string,
  version: string,
): Promise<void> {
  if (
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId) ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      version,
    )
  )
    throw new Error("invalid registry release coordinates");
  if (!config.url || !config.publishToken || /[\r\n]/.test(config.publishToken))
    throw new Error("registry deletion is not configured");
  const url = registryBaseUrl(config.url);
  url.pathname = `/v1/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${config.publishToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404 || response.status === 403) {
    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder().decode(await readBoundedBody(response, 8 * 1024)),
      );
    } catch {
      throw new PluginRegistryDeleteError("registry release deletion failed");
    }
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "code" in payload.error
        ? payload.error.code
        : undefined;
    if (response.status === 404 && code === "RELEASE_NOT_FOUND") return;
    if (response.status === 403 && code === "FORBIDDEN")
      throw new PluginRegistryDeleteError(
        "registry release is not owned by this publisher",
        403,
      );
    throw new PluginRegistryDeleteError("registry release deletion failed");
  }
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => undefined);
    throw new PluginRegistryDeleteError("registry release deletion failed");
  }
  let receipt: unknown;
  try {
    receipt = JSON.parse(
      new TextDecoder().decode(await readBoundedBody(response, 8 * 1024)),
    );
  } catch {
    throw new PluginRegistryDeleteError(
      "registry release deletion returned an invalid receipt",
    );
  }
  const data =
    receipt && typeof receipt === "object" && "data" in receipt
      ? receipt.data
      : undefined;
  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    data.id !== pluginId ||
    !("version" in data) ||
    data.version !== version ||
    !("deleted" in data) ||
    data.deleted !== true
  )
    throw new PluginRegistryDeleteError(
      "registry release deletion returned an invalid receipt",
    );
}

async function readBoundedBody(
  response: Response,
  maximum = 6 * 1024 * 1024,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new Error("artifact too large");
  if (!response.body) throw new Error("missing artifact body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new Error("artifact too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function assertRegistryAdmin(
  options: PluginStoreOptions,
  tenantId: string,
  principalId: string,
  extensionId: string,
): Promise<void> {
  if (!options.canManageExtension) {
    fail("Se requiere permiso de administración del espacio.", 403);
  }
  if (
    !(await options.canManageExtension({ tenantId, principalId, extensionId }))
  )
    fail("Se requiere permiso de administración del espacio.", 403);
}

/** Fixed registry paths are registered before the dynamic local plugin paths. */
export function registerPluginRegistry(
  app: Hono<Env>,
  options: PluginStoreOptions,
): void {
  app.get("/api/plugin-store/registry", async (c) => {
    c.header("cache-control", "private, no-store");
    await assertRegistryAdmin(
      options,
      c.get("tenant"),
      c.get("principalId"),
      "*",
    );
    const config = options.pluginRegistry;
    if (!config)
      return c.json({
        configured: false,
        canPublish: false,
        data: [],
        cursor: null,
      });
    try {
      if (!config.url || !config.token || /[\r\n]/.test(config.token))
        return c.json(
          { error: "El registro de plugins no está disponible." },
          503,
        );
      const url = registryBaseUrl(config.url);
      url.pathname = "/v1/plugins";
      const cursor = c.req.query("cursor");
      if (cursor !== undefined) {
        if (cursor.length > 2048) return fail("Cursor no válido.", 400);
        url.searchParams.set("cursor", cursor);
      }
      const response = await fetchRegistry(url, config.token);
      if (!response.ok || response.status >= 300)
        return c.json(
          { error: "El registro de plugins no está disponible." },
          503,
        );
      const bytes = await readBoundedBody(response, 128 * 1024);
      const parsed = listSchema.safeParse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (!parsed.success)
        return fail("El registro devolvió una respuesta no válida.", 502);
      return c.json({
        configured: true,
        canPublish: Boolean(config.publishToken),
        ...parsed.data,
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json(
        { error: "El registro de plugins no está disponible." },
        503,
      );
    }
  });

  app.post("/api/plugin-store/registry/publish", async (c) => {
    c.header("cache-control", "private, no-store");
    await assertRegistryAdmin(
      options,
      c.get("tenant"),
      c.get("principalId"),
      "*",
    );
    const config = options.pluginRegistry;
    if (!config || !config.publishToken)
      return c.json(
        { error: "La publicación en el registro no está configurada." },
        503,
      );
    const declaredLength = Number(c.req.header("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > PLUGIN_STORE_MAX_ZIP_BYTES + 64 * 1024
    )
      return fail("El ZIP supera el máximo de 6 MB.", 413);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File))
      return fail("Selecciona un archivo ZIP para publicar.", 400);
    let bytes: Uint8Array;
    try {
      if (file.size <= 0 || file.size > PLUGIN_STORE_MAX_ZIP_BYTES)
        return fail("El ZIP supera el máximo de 6 MB.", 413);
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return fail("No se pudo leer el ZIP.", 400);
    }
    let parsed: ParsedStoreZip;
    try {
      parsed = await parsePluginStoreZip(bytes);
    } catch {
      return fail("El ZIP no contiene un paquete válido.", 422);
    }
    try {
      const reply = await publishPluginRegistryRelease(config, parsed, bytes);
      return c.json({ data: reply.data }, reply.status);
    } catch (error) {
      if (error instanceof PluginRegistryPublishError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.post("/api/plugin-store/registry/import", async (c) => {
    c.header("cache-control", "private, no-store");
    const raw = await c.req.json().catch(() => null);
    const input = importSchema.safeParse(raw);
    if (!input.success) return fail("Datos de importación no válidos.", 400);
    await assertRegistryAdmin(
      options,
      c.get("tenant"),
      c.get("principalId"),
      input.data.id,
    );
    const config = options.pluginRegistry;
    if (!config)
      return c.json(
        { error: "El registro de plugins no está configurado." },
        503,
      );

    try {
      if (!config.url || !config.token || /[\r\n]/.test(config.token))
        return c.json(
          { error: "El registro de plugins no está disponible." },
          503,
        );
      const url = registryBaseUrl(config.url);
      url.pathname = `/v1/plugins/${encodeURIComponent(input.data.id)}/${encodeURIComponent(input.data.version)}`;
      const response = await fetchRegistry(url, config.token);
      if (!response.ok || response.status >= 300)
        return fail("No se pudo descargar la versión del registro.", 502);
      const bytes = await readBoundedBody(response);
      const actualDigest = await crypto.subtle.digest(
        "SHA-256",
        bytes as unknown as ArrayBuffer,
      );
      const sha256 = [...new Uint8Array(actualDigest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (
        sha256 !== input.data.sha256 ||
        response.headers.get("x-plugin-sha256")?.toLowerCase() !==
          input.data.sha256
      )
        return fail("El digest del paquete no coincide.", 422);
      let parsed: ParsedStoreZip;
      try {
        parsed = await parsePluginStoreZip(bytes);
      } catch {
        return fail("El paquete del registro no es válido.", 422);
      }
      if (
        parsed.manifest.id !== input.data.id ||
        parsed.manifest.version !== input.data.version
      )
        return fail(
          "La identidad del paquete no coincide con la versión solicitada.",
          422,
        );
      const result = await persistParsedStoreArtifact(
        c.env.DB,
        c.get("tenant"),
        c.get("principalId") || null,
        parsed,
      );
      return c.json({ data: result });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return fail("No se pudo importar la versión del registro.", 502);
    }
  });
}

/** Bounded catalog reads never expose the backend reader credential. */
export async function getPluginRegistryState(
  config: NonNullable<PluginStoreOptions["pluginRegistry"]>,
  pluginId: string,
  version?: string,
): Promise<{
  head: PluginHead | null;
  release: z.infer<typeof releaseSchema> | null;
}> {
  let cursor: string | null = null;
  let head: PluginHead | null = null;
  let selected: z.infer<typeof releaseSchema> | null = null;
  const visited = new Set<string>();
  try {
    for (let page = 0; page < 10; page++) {
      const url = registryBaseUrl(config.url);
      url.pathname = "/v1/plugins";
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetchRegistry(url, config.token);
      if (!response.ok) throw new Error();
      const listing = listSchema.parse(
        JSON.parse(
          new TextDecoder().decode(await readBoundedBody(response, 128 * 1024)),
        ),
      );
      for (const release of listing.data)
        if (release.id === pluginId) {
          if (release.version === version) selected = release;
          const candidate = pluginHeadSchema.parse({
            version: release.version,
            sha256: release.sha256,
          });
          if (
            !head ||
            compareSolutionVersions(candidate.version, head.version) > 0
          )
            head = candidate;
        }
      if (!listing.cursor) return { head, release: selected };
      if (visited.has(listing.cursor)) throw new Error();
      visited.add(listing.cursor);
      cursor = listing.cursor;
    }
    throw new Error();
  } catch {
    return fail("The shared plugin registry is unavailable.", 502);
  }
}

export async function getPluginRegistryHead(
  config: NonNullable<PluginStoreOptions["pluginRegistry"]>,
  pluginId: string,
): Promise<PluginHead | null> {
  return (await getPluginRegistryState(config, pluginId)).head;
}
export class PluginRegistryPublishError extends Error {
  constructor(
    public readonly status: 403 | 409 | 502 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
/** Upload exact bytes with only the server-side publisher credential. */
export async function publishPluginRegistryRelease(
  config: NonNullable<PluginStoreOptions["pluginRegistry"]>,
  parsed: ParsedStoreZip,
  bytes: Uint8Array,
): Promise<z.infer<typeof publishSchema> & { status: 200 | 201 }> {
  try {
    if (!config.publishToken || /[\r\n]/.test(config.publishToken))
      throw new PluginRegistryPublishError(
        503,
        "REGISTRY_UNAVAILABLE",
        "The shared publisher is unavailable.",
      );
    const url = registryBaseUrl(config.url);
    url.pathname = `/v1/plugins/${encodeURIComponent(parsed.manifest.id)}/${encodeURIComponent(parsed.manifest.version)}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${config.publishToken}`,
        "content-type": "application/zip",
      },
      body: bytes as unknown as BodyInit,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 409)
      throw new PluginRegistryPublishError(
        409,
        "REGISTRY_CONFLICT",
        "The shared coordinate contains a different release.",
      );
    if (response.status === 403)
      throw new PluginRegistryPublishError(
        403,
        "REGISTRY_FORBIDDEN",
        "The registry does not authorize publication.",
      );
    if (response.status !== 200 && response.status !== 201)
      throw new PluginRegistryPublishError(
        502,
        "REGISTRY_UNAVAILABLE",
        "The shared registry is unavailable.",
      );
    try {
      const receipt = publishSchema.parse(
        JSON.parse(
          new TextDecoder().decode(await readBoundedBody(response, 32 * 1024)),
        ),
      );
      if (
        receipt.data.id !== parsed.manifest.id ||
        receipt.data.version !== parsed.manifest.version
      )
        throw new Error();
      return { ...receipt, status: response.status };
    } catch {
      throw new PluginRegistryPublishError(
        502,
        "INVALID_REGISTRY_RECEIPT",
        "The registry returned an invalid publication receipt.",
      );
    }
  } catch (error) {
    if (error instanceof PluginRegistryPublishError) throw error;
    throw new PluginRegistryPublishError(
      503,
      "REGISTRY_UNAVAILABLE",
      "The shared registry is unavailable.",
    );
  }
}
