import {
  endpointSchema,
  jsonPointer,
  mapRequest,
  type OperationMap,
} from "@savia/crm-shared/collection-operations";
import { isPublicAddress } from "@savia/crm-server/integrations";
const MAX_BYTES = 1_048_576;
const MEDIA = "application/vnd.api+json";
export class JsonApiAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
    this.name = "JsonApiAdapterError";
  }
}
function fail(code: string, message: string, status = 422): never {
  throw new JsonApiAdapterError(`JSONAPI_${code}`, message, status);
}
export type JsonApiSource = {
  baseUrl: string;
  token?: string;
  supportsSort?: boolean;
  supportsFilters?: boolean;
  totalPointer?: string;
};
export type JsonApiInput = {
  operations?: OperationMap;
  source: JsonApiSource;
  resource: string;
  resourceType?: string;
  operation: "list" | "read" | "create" | "update" | "delete";
  id?: string;
  query?: {
    q?: string;
    page?: number;
    perPage?: number;
    sort?: string;
    filters?: Array<{
      field: string;
      op: "eq";
      value: string | number | boolean | null;
    }>;
  };
  data?: Record<string, unknown>;
  relationships?: Record<string, { type: string; multiple?: boolean }>;
};
export type JsonApiResult = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  total?: number;
  hasNext?: boolean | null;
  page?: number;
  perPage?: number;
};
const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const member = (v: string) =>
  /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const identifier = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 300 &&
  !/[\u0000-\u001f\u007f]/.test(v);
export function validateJsonApiBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("INVALID_URL", "Usa una URL HTTPS pública válida.");
  }
  const host = url.hostname.toLowerCase();
  if (
    typeof raw !== "string" ||
    raw !== raw.trim() ||
    /[\\%\u0000-\u0020]/.test(raw) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/.test(raw) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    host.endsWith(".") ||
    host.includes(":") ||
    /^\d+(\.\d+)*$/.test(host) ||
    /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
    !host
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    fail(
      "INVALID_URL",
      "Usa HTTPS público en puerto 443, sin IP, credenciales, consulta ni rutas relativas.",
    );
  return url;
}
export function validateJsonApiResource(resource: string): string {
  if (
    typeof resource !== "string" ||
    resource.length > 500 ||
    !resource.split("/").every(member)
  )
    fail(
      "INVALID_RESOURCE",
      "El recurso debe ser una ruta relativa fija sin navegación ni parámetros.",
    );
  return resource;
}
async function boundedJson(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    void response.body?.cancel().catch(() => {});
    fail(
      "RESPONSE_TOO_LARGE",
      "La respuesta JSON:API supera el límite permitido.",
      502,
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    fail(
      "INVALID_RESPONSE",
      "El servicio no devolvió un documento JSON:API.",
      502,
    );
  let size = 0;
  const chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        fail(
          "RESPONSE_TOO_LARGE",
          "La respuesta JSON:API supera el límite permitido.",
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    return fail(
      "INVALID_RESPONSE",
      "El servicio no devolvió un documento JSON:API válido.",
      502,
    );
  }
}
async function publicDns(url: URL, fetcher: typeof fetch, signal: AbortSignal) {
  const addresses = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const endpoint = new URL("https://cloudflare-dns.com/dns-query");
      endpoint.searchParams.set("name", url.hostname);
      endpoint.searchParams.set("type", type);
      const response = await fetcher(endpoint, {
        headers: { Accept: "application/dns-json" },
        redirect: "manual",
        signal,
      });
      if (!response.ok || response.redirected)
        fail("INVALID_URL", "No se pudo verificar el DNS público del destino.");
      const data = await boundedJson(response, 16_384, signal);
      if (
        !plain(data) ||
        data.Status !== 0 ||
        (data.Answer !== undefined && !Array.isArray(data.Answer))
      )
        fail("INVALID_URL", "No se pudo verificar el DNS público del destino.");
      return ((data.Answer ?? []) as unknown[]).flatMap((answer) =>
        plain(answer) && [1, 28].includes(Number(answer.type))
          ? [answer.data]
          : [],
      );
    }),
  );
  const ips = addresses.flat();
  if (
    !ips.length ||
    ips.some((ip) => typeof ip !== "string" || !isPublicAddress(ip))
  )
    fail(
      "INVALID_URL",
      "El destino debe resolver exclusivamente a direcciones públicas.",
    );
}
function linkage(
  value: unknown,
): Record<string, string> | Array<Record<string, string>> | null {
  if (value === null) return null;
  if (Array.isArray(value))
    return value.map((item) => {
      const link = linkage(item);
      if (!link || Array.isArray(link))
        fail("INVALID_RESPONSE", "Relación JSON:API inválida.", 502);
      return link;
    });
  if (
    !plain(value) ||
    !identifier(value.id) ||
    typeof value.type !== "string" ||
    !member(value.type)
  )
    return fail("INVALID_RESPONSE", "Relación JSON:API inválida.", 502);
  return { id: value.id, type: value.type };
}
function flatten(value: unknown): Record<string, unknown> {
  if (
    !plain(value) ||
    !identifier(value.id) ||
    typeof value.type !== "string" ||
    !member(value.type) ||
    (value.attributes !== undefined && !plain(value.attributes)) ||
    (value.relationships !== undefined && !plain(value.relationships))
  )
    fail(
      "INVALID_RESPONSE",
      "El servicio devolvió un recurso JSON:API inválido.",
      502,
    );
  const attributes = (value.attributes ?? {}) as Record<string, unknown>,
    reserved = ["id", "type", "_relationships", "_version"];
  if (
    Object.keys(attributes).some(
      (key) => !member(key) || reserved.includes(key),
    )
  )
    fail(
      "INVALID_RESPONSE",
      "El recurso contiene atributos reservados o inválidos.",
      502,
    );
  const result: Record<string, unknown> = {
      ...attributes,
      id: value.id,
      type: value.type,
    },
    relationships: Record<string, unknown> = {};
  for (const [key, relationship] of Object.entries(value.relationships ?? {})) {
    if (
      !member(key) ||
      reserved.includes(key) ||
      Object.hasOwn(attributes, key) ||
      !plain(relationship)
    )
      fail(
        "INVALID_RESPONSE",
        "El recurso contiene relaciones inválidas.",
        502,
      );
    // Link-only relationships do not imply loaded or empty linkage.
    if (!Object.hasOwn(relationship, "data")) continue;
    const link = linkage(relationship.data);
    relationships[key] = link;
    result[key] = Array.isArray(link)
      ? link.map((item) => item.id)
      : (link?.id ?? null);
  }
  if (Object.keys(relationships).length) result._relationships = relationships;
  return result;
}
function writeDocument(input: JsonApiInput, type: string): string {
  if (!plain(input.data))
    fail("INVALID_INPUT", "Los atributos del recurso son obligatorios.");
  const attributes: Record<string, unknown> = {},
    relationships: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.data)) {
    if (key === "_version") continue; // Remote versions are not local optimistic-lock tokens.
    if (key === "id" || key === "type") {
      if (value !== (key === "id" ? input.id : type))
        fail(
          "INVALID_INPUT",
          "La identidad del recurso no coincide con la solicitud.",
        );
      continue;
    }
    if (!member(key) || key === "_relationships")
      fail(
        "INVALID_INPUT",
        "El recurso contiene un atributo reservado o inválido.",
      );
    const relation =
      input.relationships && Object.hasOwn(input.relationships, key)
        ? input.relationships[key]
        : undefined;
    if (!relation) {
      attributes[key] = value;
      continue;
    }
    if (!member(relation.type))
      fail("INVALID_INPUT", "Tipo de relación inválido.");
    const toLink = (id: unknown) => {
      if (!identifier(id))
        fail("INVALID_INPUT", "Identificador de relación inválido.");
      return { type: relation.type, id };
    };
    relationships[key] = {
      data: relation.multiple
        ? Array.isArray(value)
          ? value.map(toLink)
          : fail(
              "INVALID_INPUT",
              "La relación requiere una lista de identificadores.",
            )
        : value === null
          ? null
          : toLink(value),
    };
  }
  let body: string;
  try {
    body = JSON.stringify({
      data: {
        type,
        ...(["update", "delete"].includes(input.operation)
          ? { id: input.id }
          : {}),
        attributes,
        ...(Object.keys(relationships).length ? { relationships } : {}),
      },
    });
  } catch {
    return fail(
      "INVALID_INPUT",
      "El recurso no se puede serializar como JSON.",
    );
  }
  if (new TextEncoder().encode(body).length > MAX_BYTES)
    fail("REQUEST_TOO_LARGE", "El recurso supera el límite de 1 MB.", 413);
  return body;
}
function pointer(document: Record<string, unknown>, path: string): unknown {
  let value: unknown = document;
  for (const part of path.slice(1).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!plain(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
/** The collection gateway authorizes operation capabilities before invoking this adapter. */
export async function executeJsonApi(
  input: JsonApiInput,
  fetcher: typeof fetch = fetch,
): Promise<JsonApiResult> {
  const base = validateJsonApiBaseUrl(input.source.baseUrl),
    resource = validateJsonApiResource(input.resource),
    type = input.resourceType ?? resource.split("/").at(-1)!;
  if (!member(type)) fail("INVALID_INPUT", "Tipo de recurso inválido.");
  if (!["list", "read", "create", "update", "delete"].includes(input.operation))
    fail("INVALID_INPUT", "Operación inválida.");
  const single = ["read", "update", "delete"].includes(input.operation);
  if (
    single &&
    (!identifier(input.id) ||
      /[/%\\?#]/.test(input.id) ||
      [".", ".."].includes(input.id))
  )
    fail("INVALID_INPUT", "Identificador de recurso inválido.");
  let endpoint = input.operations
    ? input.operations[input.operation]
    : undefined;
  if (input.operations && !endpoint)
    fail("OPERATION_DISABLED", "Operación no configurada.", 405);
  if (endpoint) endpoint = endpointSchema.parse(endpoint);
  const route = endpoint
    ? endpoint.path
        .replace(/^\//, "")
        .replace("{id}", encodeURIComponent(input.id ?? ""))
    : resource + (single ? "/" + encodeURIComponent(input.id!) : "");
  const url = new URL(base.href.replace(/\/$/, "") + "/" + route);
  const query = input.query ?? {},
    page = query.page ?? 1,
    perPage = query.perPage ?? 25;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 200
  )
    fail("INVALID_INPUT", "Paginación inválida.");
  if (
    (query.sort && !input.source.supportsSort) ||
    (query.filters?.length && !input.source.supportsFilters)
  )
    fail(
      "QUERY_UNSUPPORTED",
      "Esta colección no habilita ordenación o filtros remotos.",
    );
  if (
    input.source.totalPointer &&
    (!input.source.totalPointer.startsWith("/") ||
      input.source.totalPointer.length > 300 ||
      /~(?![01])/.test(input.source.totalPointer))
  )
    fail("INVALID_INPUT", "La ruta JSON del total no es válida.");
  if (input.operation === "list") {
    url.searchParams.set(
      endpoint?.pageParameter ?? "page[number]",
      String(page),
    );
    url.searchParams.set(
      endpoint?.sizeParameter ?? "page[size]",
      String(perPage),
    );
    if (query.q && endpoint?.searchParameter)
      url.searchParams.set(endpoint.searchParameter, query.q);
    if (query.sort) {
      if (
        query.sort.length > 1000 ||
        !query.sort.split(",").every((key) => member(key.replace(/^-/, "")))
      )
        fail("INVALID_INPUT", "Ordenación inválida.");
      url.searchParams.set("sort", query.sort);
    }
    if ((query.filters?.length ?? 0) > 20)
      fail("INVALID_INPUT", "Demasiados filtros.");
    for (const filter of query.filters ?? []) {
      if (
        filter.op !== "eq" ||
        !member(filter.field) ||
        (filter.value !== null &&
          !["string", "number", "boolean"].includes(typeof filter.value)) ||
        (typeof filter.value === "number" && !Number.isFinite(filter.value)) ||
        String(filter.value ?? "").length > 2000
      )
        fail(
          "INVALID_INPUT",
          "Solo se admiten filtros de igualdad con valores simples.",
        );
      if (url.searchParams.has(`filter[${filter.field}]`))
        fail("INVALID_INPUT", "No se puede repetir un campo de filtro.");
      url.searchParams.set(
        `filter[${filter.field}]`,
        String(filter.value ?? ""),
      );
    }
  }
  const mapped = endpoint
    ? mapRequest(input.data ?? {}, endpoint.requestFields)
    : input.data;
  const wantsBody =
    ["create", "update"].includes(input.operation) ||
    (input.operation === "delete" && endpoint?.method === "POST");
  const body = wantsBody
    ? endpoint?.format === "json"
      ? JSON.stringify({
          ...mapped,
          ...(single && !endpoint.path.includes("{id}")
            ? { [endpoint.idBodyField]: input.id }
            : {}),
        })
      : writeDocument({ ...input, data: mapped }, type)
    : undefined;
  if (body && new TextEncoder().encode(body).length > MAX_BYTES)
    fail("REQUEST_TOO_LARGE", "El cuerpo supera 1 MB.", 413);
  if (
    input.source.token &&
    (input.source.token.length > 8192 || /[\r\n]/.test(input.source.token))
  )
    fail("INVALID_INPUT", "Credencial de conexión inválida.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new JsonApiAdapterError(
          "JSONAPI_TIMEOUT",
          "El servicio JSON:API tardó demasiado en responder.",
          504,
        ),
      );
    }, 10_000);
  });
  const execute = async (): Promise<JsonApiResult> => {
    await publicDns(base, fetcher, controller.signal);
    const request = async (method: string, requestBody?: string) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await fetcher(url, {
        method,
        headers: {
          Accept: endpoint?.format === "json" ? "application/json" : MEDIA,
          ...(requestBody
            ? {
                "Content-Type":
                  endpoint?.format === "json" ? "application/json" : MEDIA,
              }
            : {}),
          ...(input.source.token
            ? { Authorization: `Bearer ${input.source.token}` }
            : {}),
        },
        ...(requestBody ? { body: requestBody } : {}),
        redirect: "manual",
        signal: controller.signal,
      });
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      ) {
        void response.body?.cancel().catch(() => {});
        fail(
          "REDIRECT",
          "El servicio JSON:API intentó redirigir la operación.",
          502,
        );
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        fail(
          "UPSTREAM_ERROR",
          "El servicio JSON:API rechazó la operación.",
          [404, 409, 422].includes(response.status) ? response.status : 502,
        );
      }
      return response;
    };
    let response = await request(
      endpoint?.method ??
        {
          list: "GET",
          read: "GET",
          create: "POST",
          update: "PATCH",
          delete: "DELETE",
        }[input.operation],
      body,
    );
    // JSON:API allows successful updates with no resource document. Read the
    // persisted representation once; never replay the mutation on read failure.
    if (input.operation === "update" && response.status === 204) {
      if (input.operations) {
        if (!input.operations.read) return { data: { id: input.id! } };
        return executeJsonApi(
          { ...input, operation: "read", data: undefined },
          fetcher,
        );
      }
      response = await request("GET");
    }
    if (input.operation === "delete" && response.status === 204)
      return { data: null };
    const media = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (![MEDIA, "application/json"].includes(media ?? "")) {
      void response.body?.cancel().catch(() => {});
      fail(
        "INVALID_RESPONSE",
        "El servicio no devolvió contenido JSON:API.",
        502,
      );
    }
    const document = await boundedJson(response, MAX_BYTES, controller.signal);
    if (endpoint?.format === "json") {
      if (input.operation === "delete") return { data: null };
      const raw = jsonPointer(document, endpoint.dataPointer);
      const convert = (record: unknown): Record<string, unknown> => {
        if (!plain(record))
          fail("INVALID_RESPONSE", "Se esperaba un registro JSON.", 502);
        const id = jsonPointer(record, endpoint.idPointer);
        if (
          !["string", "number"].includes(typeof id) ||
          !identifier(String(id))
        )
          fail(
            "INVALID_RESPONSE",
            "La respuesta no tiene un identificador válido.",
            502,
          );
        const attrs = Object.keys(endpoint.responseFields).length
          ? Object.fromEntries(
              Object.entries(endpoint.responseFields).map(([field, path]) => [
                field,
                jsonPointer(record, path),
              ]),
            )
          : record;
        if (
          Object.keys(attrs).some(
            (k) =>
              !member(k) ||
              ["__proto__", "constructor", "prototype"].includes(k),
          )
        )
          fail(
            "INVALID_RESPONSE",
            "La respuesta contiene campos inválidos.",
            502,
          );
        return { ...attrs, id: String(id) };
      };
      if (input.operation !== "list") return { data: convert(raw) };
      if (!Array.isArray(raw) || raw.length > perPage)
        fail(
          "INVALID_RESPONSE",
          "La respuesta no respeta la paginación configurada.",
          502,
        );
      const total = endpoint.totalPointer
        ? jsonPointer(document, endpoint.totalPointer)
        : undefined;
      if (total !== undefined && (!Number.isSafeInteger(total) || total < 0))
        fail("INVALID_RESPONSE", "Total inválido.", 502);
      return {
        data: raw.map(convert),
        ...(total !== undefined ? { total } : {}),
        page,
        perPage,
        hasNext:
          total !== undefined ? page * perPage < total : raw.length === perPage,
      };
    }
    if (!plain(document) || document.errors !== undefined)
      fail(
        "INVALID_RESPONSE",
        "El servicio devolvió un documento JSON:API inválido.",
        502,
      );
    if (input.operation === "delete") return { data: null };
    const project = (record: unknown) => {
      const value = flatten(record);
      if (!endpoint || !Object.keys(endpoint.responseFields).length)
        return value;
      return {
        ...Object.fromEntries(
          Object.entries(endpoint.responseFields).map(([key, path]) => [
            key,
            jsonPointer(record, path),
          ]),
        ),
        id: value.id,
        type: value.type,
        ...(value._relationships
          ? { _relationships: value._relationships }
          : {}),
      };
    };
    if (input.operation !== "list") return { data: project(document.data) };
    if (!Array.isArray(document.data) || document.data.length > perPage)
      fail(
        "INVALID_RESPONSE",
        "El servicio no respetó la página JSON:API solicitada.",
        502,
      );
    const total = input.source.totalPointer
      ? pointer(document, input.source.totalPointer)
      : undefined;
    if (
      total !== undefined &&
      (!Number.isSafeInteger(total) || Number(total) < 0)
    )
      fail("INVALID_RESPONSE", "El servicio devolvió un total inválido.", 502);
    const next =
      plain(document.links) && Object.hasOwn(document.links, "next")
        ? document.links.next
        : undefined;
    if (
      next !== undefined &&
      next !== null &&
      !(typeof next === "string" && next.length > 0) &&
      !(plain(next) && typeof next.href === "string" && next.href.length > 0)
    )
      fail(
        "INVALID_RESPONSE",
        "El servicio devolvió un enlace de paginación inválido.",
        502,
      );
    const hasNext =
      total !== undefined
        ? page * perPage < Number(total)
        : next === undefined
          ? null
          : next !== null;
    return {
      data: document.data.map(project),
      ...(total === undefined ? {} : { total: Number(total) }),
      hasNext,
      page,
      perPage,
    };
  };
  try {
    return await Promise.race([execute(), timeout]);
  } catch (error) {
    if (error instanceof JsonApiAdapterError) throw error;
    if (controller.signal.aborted)
      fail(
        "TIMEOUT",
        "El servicio JSON:API tardó demasiado en responder.",
        504,
      );
    return fail(
      "UNAVAILABLE",
      "No se pudo conectar con el servicio JSON:API.",
      502,
    );
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}
