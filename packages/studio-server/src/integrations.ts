import type { Hono } from "hono";
import { z } from "zod";
import {
  inspectDocument,
  schemaToObject,
  resolveSchema,
  validateJsonSchema,
  MAX_DOCUMENT_BYTES,
} from "@savia/studio-shared/openapi";
import { identifier } from "@savia/studio-shared/metadata";
import { createRecord } from "./services";
import { type Env, fail } from "./context";
const blockedHeaders =
  /^(host|connection|content-length|cookie|set-cookie|transfer-encoding|forwarded|x-forwarded-.+|proxy-.+|sec-.+)$/i;
const connectionSchema = z.object({
  mode: z.enum(["demo", "external"]),
  baseUrl: z.string().max(2048).default(""),
  authType: z.enum(["none", "bearer", "api-key"]).default("none"),
  authHeader: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/)
    .default("X-API-Key"),
  secret: z.string().max(8192).optional(),
  clearSecret: z.boolean().optional(),
  supportsIdempotency: z.boolean().default(false),
});
export function publicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("URL inválida.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    return fail(
      "Usa HTTPS público en puerto 443, sin credenciales ni fragmento.",
    );
  if (
    !host.includes(".") ||
    /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
    host.endsWith(".") ||
    host.includes(":") ||
    /^\d+(\.\d+)*$/.test(host)
  )
    return fail(
      "El destino debe ser un dominio público, no una IP o red interna.",
    );
  return url;
}
export function isPublicAddress(address: string): boolean {
  if (address.includes(":")) {
    // Global unicast only. Also exclude documentation and IPv4 tunnelling/mapping ranges.
    return (
      /^[23][0-9a-f]{0,3}:/i.test(address) &&
      !/^2001:(db8|0|10|20)(:|$)/i.test(address) &&
      !/^2002:/i.test(address) &&
      !address.includes(".")
    );
  }
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b, c] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export async function validatePublicDns(
  url: URL,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const answers = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const endpoint = new URL("https://cloudflare-dns.com/dns-query");
      endpoint.searchParams.set("name", url.hostname);
      endpoint.searchParams.set("type", type);
      const response = await fetcher(endpoint, {
        headers: { Accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        return fail("No se pudo verificar el DNS público.", 502);
      const data: any = await response.json();
      if (data.Status !== 0)
        return fail("No se pudo resolver el destino público.", 422);
      return (data.Answer ?? [])
        .filter((a: any) => [1, 28].includes(a.type))
        .map((a: any) => a.data as string);
    }),
  );
  const ips = answers.flat();
  if (!ips.length || ips.some((ip) => !isPublicAddress(ip)))
    return fail(
      "El DNS debe resolver exclusivamente a direcciones públicas.",
      422,
    );
}
export async function boundedText(
  response: Response,
  limit = MAX_DOCUMENT_BYTES,
): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > limit)
    return fail("La respuesta supera 1 MB.", 413);
  if (!response.body) return "";
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      return fail("La respuesta supera 1 MB.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
const encode64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const decode64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function encryptionKey(secret?: string) {
  if (!secret || secret.length < 32)
    return fail(
      "Falta INTEGRATION_KEY de al menos 32 caracteres en el servidor.",
      422,
    );
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptSecret(
  value: string,
  key: string | undefined,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await encryptionKey(key),
    new TextEncoder().encode(value),
  );
  return `${encode64(iv)}.${encode64(new Uint8Array(bytes))}`;
}
export async function decryptSecret(
  value: string,
  key: string | undefined,
  context: string,
): Promise<string> {
  try {
    const [iv, data] = value.split(".");
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode64(iv),
          additionalData: new TextEncoder().encode(context),
        },
        await encryptionKey(key),
        decode64(data),
      ),
    );
  } catch {
    return fail(
      "No se pudo descifrar la credencial; vuelve a guardarla con la clave actual.",
      422,
    );
  }
}
function safeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Error de integración";
  // Network implementations may place URLs and embedded parameters in error messages.
  return message.includes("://")
    ? "La solicitud HTTP no pudo completarse."
    : message.slice(0, 500);
}
function redact(value: any, secret: string): any {
  if (typeof value === "string")
    return secret ? value.split(secret).join("[redactado]") : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, secret));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /authorization|password|secret|token|api[-_]?key|cookie/i.test(k)
          ? "[redactado]"
          : redact(v, secret),
      ]),
    );
  return value;
}
async function getIntegration(
  db: D1Database,
  tenant: string,
  id: string,
  principalId: string,
): Promise<any> {
  const row = await db
    .prepare(
      "SELECT * FROM studio_integrations WHERE tenant_id=? AND id=? AND owner_principal_id=?",
    )
    .bind(tenant, id, principalId)
    .first<any>();
  if (!row) return fail("La integración no existe.", 404);
  return row;
}
function publicIntegration(row: any) {
  return {
    id: row.id,
    name: row.name,
    document: JSON.parse(row.document),
    connection: JSON.parse(row.connection || "{}"),
    hasSecret: !!row.encrypted_secret,
    created_at: row.created_at,
  };
}
export function registerIntegrations(
  app: Hono<Env>,
  integrationFetch?: typeof fetch,
) {
  const fetcher: typeof fetch = (input, init) =>
    (integrationFetch ?? fetch)(input, init);
  app.use("/api/integrations", async (c, next) => {
    if (!c.get("principalId"))
      return c.json({ error: "Se requiere un usuario autenticado." }, 403);
    return next();
  });
  app.use("/api/integrations/*", async (c, next) => {
    if (!c.get("principalId"))
      return c.json({ error: "Se requiere un usuario autenticado." }, 403);
    return next();
  });
  app.get("/api/integrations", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM studio_integrations WHERE tenant_id=? AND owner_principal_id=? ORDER BY created_at DESC",
    )
      .bind(c.get("tenant"), c.get("principalId"))
      .all<any>();
    return c.json({ data: results.map(publicIntegration) });
  });
  app.post("/api/integrations", async (c) => {
    const input = z
      .object({
        document: z.unknown().optional(),
        url: z.string().max(2048).optional(),
      })
      .parse(await c.req.json());
    let document = input.document;
    if (input.url) {
      const url = publicUrl(input.url);
      await validatePublicDns(url, fetcher);
      const response = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json, application/yaml, text/yaml" },
      });
      if (!response.ok)
        return fail(
          `No se pudo descargar el contrato: HTTP ${response.status}.`,
          502,
        );
      document = await boundedText(response);
    }
    let info;
    try {
      info = inspectDocument(document);
    } catch (e) {
      return fail(safeError(e), 422);
    }
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO studio_integrations (id,tenant_id,owner_principal_id,name,document) VALUES (?,?,?,?,?)",
    )
      .bind(
        id,
        c.get("tenant"),
        c.get("principalId"),
        info.title,
        JSON.stringify(info.document),
      )
      .run();
    return c.json(
      {
        data: {
          id,
          name: info.title,
          ...info,
          connection: {},
          hasSecret: false,
        },
      },
      201,
    );
  });
  app.put("/api/integrations/:id/connection", async (c) => {
    const row = await getIntegration(
      c.env.DB,
      c.get("tenant"),
      c.req.param("id"),
      c.get("principalId"),
    );
    const { secret, clearSecret, ...config } = connectionSchema.parse(
      await c.req.json(),
    );
    if (config.mode === "external") {
      const url = publicUrl(config.baseUrl);
      if (url.search) return fail("La URL base no debe contener parámetros.");
      config.baseUrl = url.toString().replace(/\/$/, "");
    } else {
      config.baseUrl = "";
      config.authType = "none";
    }
    if (blockedHeaders.test(config.authHeader))
      return fail("Cabecera de autenticación no permitida.");
    let encrypted =
      clearSecret || config.authType === "none" ? null : row.encrypted_secret;
    if (secret && config.authType !== "none")
      encrypted = await encryptSecret(
        secret,
        c.env.INTEGRATION_KEY,
        `${c.get("tenant")}:${c.get("principalId")}:${row.id}`,
      );
    if (config.authType !== "none" && !encrypted)
      return fail("Introduce una credencial para esta conexión.", 422);
    await c.env.DB.prepare(
      "UPDATE studio_integrations SET connection=?,encrypted_secret=? WHERE tenant_id=? AND id=? AND owner_principal_id=?",
    )
      .bind(
        JSON.stringify(config),
        encrypted,
        c.get("tenant"),
        row.id,
        c.get("principalId"),
      )
      .run();
    return c.json({ data: { connection: config, hasSecret: !!encrypted } });
  });
  app.post("/api/integrations/:id/import", async (c) => {
    const input = z
      .object({ schema: z.string(), name: identifier })
      .parse(await c.req.json());
    const row = await getIntegration(
        c.env.DB,
        c.get("tenant"),
        c.req.param("id"),
        c.get("principalId"),
      ),
      document = JSON.parse(row.document);
    let object;
    try {
      object = schemaToObject(
        document,
        document.components?.schemas?.[input.schema],
        input.name,
      );
    } catch (e) {
      return fail(safeError(e), 422);
    }
    return app.request(
      "http://127.0.0.1/api/objects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(object),
      },
      c.env,
    );
  });
  app.get("/api/integrations/:id/runs", async (c) => {
    await getIntegration(
      c.env.DB,
      c.get("tenant"),
      c.req.param("id"),
      c.get("principalId"),
    );
    const { results } = await c.env.DB.prepare(
      "SELECT id,operation_id,method,status,http_status,attempts,duration_ms,error,created_at FROM studio_integration_runs WHERE tenant_id=? AND integration_id=? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(c.get("tenant"), c.req.param("id"))
      .all();
    return c.json({ data: results });
  });
  app.post("/api/integrations/:id/execute", async (c) => {
    const input = z
      .object({
        operationId: z.string(),
        parameters: z.record(z.string(), z.unknown()).default({}),
        body: z.unknown().optional(),
        confirmWrite: z.boolean().default(false),
        idempotencyKey: z
          .string()
          .min(8)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/)
          .optional(),
      })
      .parse(await c.req.json());
    const db = c.env.DB,
      tenant = c.get("tenant"),
      row = await getIntegration(
        db,
        tenant,
        c.req.param("id"),
        c.get("principalId"),
      );
    const info = inspectDocument(JSON.parse(row.document)),
      op = info.operations.find((o) => o.id === input.operationId);
    if (!op) return fail("Operación no encontrada.", 404);
    if (op.error) return fail(op.error, 422);
    const config = JSON.parse(row.connection || "{}");
    if (!config.mode)
      return fail("Guarda una conexión antes de ejecutar.", 422);
    if (op.method !== "GET" && !input.confirmWrite)
      return fail("Marca la autorización de escritura antes de ejecutar.", 422);
    if (input.body !== undefined && !op.bodySchema)
      return fail("Esta operación no declara cuerpo JSON.", 422);
    if (op.bodyRequired && input.body === undefined)
      return fail("El cuerpo JSON es obligatorio.", 422);
    if (op.bodySchema && input.body !== undefined) {
      const errors = validateJsonSchema(
        info.document,
        op.bodySchema,
        input.body,
      );
      if (errors.length) return fail(errors.join(". "), 422);
    }
    let path = op.path;
    const query = new URLSearchParams(),
      headers = new Headers({ Accept: "application/json" });
    const known = new Set(op.parameters.map((p) => `${p.in}:${p.name}`));
    if (Object.keys(input.parameters).some((k) => !known.has(k)))
      return fail("Hay parámetros que no pertenecen a la operación.", 422);
    for (const param of op.parameters) {
      let value = input.parameters[`${param.in}:${param.name}`];
      if (value === undefined || value === "") {
        if (param.required || param.in === "path")
          return fail(`Parámetro obligatorio: ${param.name}`, 422);
        continue;
      }
      const type = param.schema.type;
      if (typeof value === "string" && ["integer", "number"].includes(type))
        value = Number(value);
      if (typeof value === "string" && type === "boolean")
        value = value === "true" ? true : value === "false" ? false : value;
      const errors = validateJsonSchema(info.document, param.schema, value);
      if (errors.length)
        return fail(`${param.name}: ${errors.join(". ")}`, 422);
      if (typeof value === "object" && !Array.isArray(value))
        return fail(
          "Los parámetros objeto requieren una serialización no admitida.",
          422,
        );
      if (param.in === "path")
        path = path
          .split(`{${param.name}}`)
          .join(
            encodeURIComponent(
              Array.isArray(value) ? value.join(",") : String(value),
            ),
          );
      if (param.in === "query")
        for (const v of Array.isArray(value) ? value : [value])
          query.append(param.name, String(v));
      if (param.in === "header") {
        if (
          blockedHeaders.test(param.name) ||
          /authorization/i.test(param.name)
        )
          return fail("Configura las credenciales en la conexión.");
        headers.set(
          param.name,
          Array.isArray(value) ? value.join(",") : String(value),
        );
      }
    }
    if (
      path.includes("{") ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("\\") ||
      path.includes("?") ||
      path.includes("#") ||
      path.split("/").some((p) => {
        try {
          return [".", ".."].includes(decodeURIComponent(p));
        } catch {
          return true;
        }
      })
    )
      return fail("Ruta de operación inválida.");
    if (input.body !== undefined)
      headers.set("Content-Type", "application/json");
    const local = config.mode === "demo";
    if (local && (op.method !== "POST" || path !== "/demo/quotes"))
      return fail("La conexión demo permite solamente POST /demo/quotes.", 422);
    let url: URL | undefined;
    if (!local) {
      url = publicUrl(`${config.baseUrl.replace(/\/$/, "")}${path}`);
      url.search = query.toString();
    }
    const key = input.idempotencyKey ?? null;
    const requestHash = encode64(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify({
              operation: op.id,
              params: input.parameters,
              body: input.body,
              connection: config,
            }),
          ),
        ),
      ),
    );
    if (key) {
      const old = await db
        .prepare(
          "SELECT * FROM studio_integration_runs WHERE tenant_id=? AND integration_id=? AND operation_id=? AND idempotency_key=?",
        )
        .bind(tenant, row.id, op.id, key)
        .first<any>();
      if (old) {
        if (old.request_hash !== requestHash)
          return fail(
            "La clave de idempotencia ya pertenece a otra solicitud.",
            409,
          );
        if (old.status === "running")
          return fail(
            "Esta solicitud sigue en curso. Revisa el historial antes de repetir.",
            409,
          );
        return c.json({
          data: old.response ? JSON.parse(old.response) : null,
          run: {
            id: old.id,
            status: old.status,
            httpStatus: old.http_status,
            attempts: old.attempts,
            error: old.error,
          },
          replayed: true,
        });
      }
    }
    if (url) await validatePublicDns(url, fetcher);
    const runId = crypto.randomUUID(),
      started = Date.now();
    try {
      await db
        .prepare(
          "INSERT INTO studio_integration_runs (id,tenant_id,integration_id,operation_id,method,status,idempotency_key,request_hash) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          runId,
          tenant,
          row.id,
          op.id,
          op.method,
          "running",
          key,
          requestHash,
        )
        .run();
    } catch {
      return fail(
        "Esta solicitud ya fue reservada. Revisa el historial antes de repetir.",
        409,
      );
    }
    let attempts = 0,
      status = "failed",
      httpStatus: number | null = null,
      result: any = null,
      error: string | null = null;
    try {
      const secret = row.encrypted_secret
        ? await decryptSecret(
            row.encrypted_secret,
            c.env.INTEGRATION_KEY,
            `${tenant}:${c.get("principalId")}:${row.id}`,
          )
        : "";
      if (!local && config.authType === "bearer")
        headers.set("Authorization", `Bearer ${secret}`);
      if (!local && config.authType === "api-key")
        headers.set(config.authHeader, secret);
      if (key && config.supportsIdempotency)
        headers.set("Idempotency-Key", key);
      const maxAttempts =
        op.method === "GET" || (key && config.supportsIdempotency) ? 2 : 1;
      let response: Response | undefined;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          response = local
            ? await app.request(
                "http://127.0.0.1/api/demo/quotes",
                { method: "POST", headers, body: JSON.stringify(input.body) },
                c.env,
              )
            : await fetcher(url!, {
                method: op.method,
                headers,
                body:
                  input.body === undefined
                    ? undefined
                    : JSON.stringify(input.body),
                redirect: "error",
                signal: AbortSignal.timeout(10000),
              });
          if (
            ![502, 503, 504].includes(response.status) ||
            attempts >= maxAttempts
          )
            break;
          await response.body?.cancel();
        } catch (e) {
          if (attempts >= maxAttempts) throw e;
        }
      }
      httpStatus = response!.status;
      const text = await boundedText(response!);
      try {
        result = JSON.parse(text);
      } catch {
        result = text;
      }
      status = response!.ok ? "succeeded" : "failed";
      if (!response!.ok) error = `El servicio respondió HTTP ${httpStatus}.`;
      const responseSpec =
        op.responses[String(httpStatus)] ??
        op.responses[`${String(httpStatus)[0]}XX`] ??
        op.responses.default;
      if (responseSpec && response!.ok) {
        const schema = resolveSchema(info.document, responseSpec).content?.[
          "application/json"
        ]?.schema;
        if (schema) {
          const errors = validateJsonSchema(info.document, schema, result);
          if (errors.length) {
            status = "invalid-response";
            error = `Respuesta fuera de contrato: ${errors.join(". ")}`;
          }
        }
      }
      result = redact(result, secret);
    } catch (e) {
      error = safeError(e);
      result = null;
      status = op.method === "GET" || attempts === 0 ? "failed" : "unknown";
    }
    const durationMs = Date.now() - started;
    await db
      .prepare(
        "UPDATE studio_integration_runs SET status=?,http_status=?,attempts=?,duration_ms=?,error=?,response=? WHERE id=? AND tenant_id=?",
      )
      .bind(
        status,
        httpStatus,
        attempts,
        durationMs,
        error,
        result === null ? null : JSON.stringify(result),
        runId,
        tenant,
      )
      .run();
    return c.json({
      data: result,
      run: { id: runId, status, httpStatus, attempts, durationMs, error },
    });
  });
  app.post("/api/integrations/:id/runs/:run/save", async (c) => {
    await getIntegration(
      c.env.DB,
      c.get("tenant"),
      c.req.param("id"),
      c.get("principalId"),
    );
    const input = z
      .object({
        object: identifier,
        mapping: z
          .record(identifier, z.string().max(200))
          .refine(
            (v) => Object.keys(v).length > 0,
            "Configura al menos un campo.",
          ),
      })
      .parse(await c.req.json());
    const row = await c.env.DB.prepare(
      "SELECT response,status FROM studio_integration_runs WHERE tenant_id=? AND integration_id=? AND id=?",
    )
      .bind(c.get("tenant"), c.req.param("id"), c.req.param("run"))
      .first<any>();
    if (!row || row.status !== "succeeded" || !row.response)
      return fail("Solo se pueden guardar respuestas correctas.", 422);
    const response = JSON.parse(row.response),
      data: Record<string, unknown> = {};
    for (const [field, path] of Object.entries(input.mapping)) {
      if (!/^\/?[A-Za-z0-9_~/-]*$/.test(path))
        return fail("Usa rutas JSON Pointer como /customer/name.");
      const segments = path
        .replace(/^\//, "")
        .split("/")
        .filter(Boolean)
        .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
      if (
        segments.some((p) =>
          ["__proto__", "constructor", "prototype"].includes(p),
        )
      )
        return fail("Ruta reservada.");
      const value = segments.reduce((v: any, k) => v?.[k], response);
      data[field] =
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value;
    }
    const saved = await createRecord(
      c.env.DB,
      c.get("tenant"),
      input.object,
      data,
      { idempotencyKey: `integration-${c.req.param("run")}-${input.object}` },
    );
    return c.json({ data: saved }, 201);
  });
}
