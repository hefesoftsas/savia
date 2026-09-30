import { z } from "zod";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Env, fail } from "./context";
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
    if (!config) return c.json({ configured: false, data: [], cursor: null });
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
      return c.json({ configured: true, ...parsed.data });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json(
        { error: "El registro de plugins no está disponible." },
        503,
      );
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
