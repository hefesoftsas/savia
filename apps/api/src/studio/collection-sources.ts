import {
  isDatabaseKind,
  databaseSourceInputSchema,
  databaseSourceConfigFromInput,
  databaseFieldInterface,
  deriveDatabaseCapabilities,
  resolveRecordKey,
  DatabaseBridgeError,
  type DatabaseKind,
  type ResourceMetadata,
} from "@savia/studio-shared/database-sources";
import {
  createDatabaseSourceService,
  type DatabaseSourceRow,
} from "./database-source-service";
import type { DatabaseBridgeClient } from "./database-bridge";
import {
  assertCollectionOption,
  loadCollectionOptions,
} from "./collection-options";
import { createCollectionOperationsApp } from "./collection-operations";
import type { OperationMap } from "@savia/studio-shared/collection-operations";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "@hono/zod-openapi";
import {
  emptyCollectionDomainProvider,
  type CollectionDomainProvider,
} from "./collection-domain-provider";
import {
  createSqlBridgeClient,
  SqlBridgeError,
  type BridgeConnectionWithPassword,
  type SqlBridgeClient,
} from "./sql-bridge";
import { DomainCommandError } from "../domains/contracts";
import {
  postgresFieldLabel,
  postgresSourceConfigFromInput,
  postgresSourceConfigSchema,
  postgresTypeToFieldType,
  sqlIdentifier,
  type BridgeTable,
} from "@savia/studio-shared/sql-sources";
import type { DomainCollection, DomainDocument } from "../domains/contracts";
function isUniqueConstraint(error: unknown): boolean {
  let current = error;
  while (current instanceof Error) {
    if (/unique constraint/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}
import {
  encryptSecret,
  decryptSecret,
} from "@savia/studio-server/integrations";
import { createStudioApp } from "@savia/studio-server/index";
import {
  audit,
  getObject,
  guard,
  transaction,
} from "@savia/studio-server/services";
import {
  objectSchema,
  validateRecord,
  type StudioObject,
  type CollectionCapabilities,
  type CollectionBindingMetadata,
} from "@savia/studio-shared/metadata";
import { filterSchema } from "@savia/studio-server/query";
import {
  executeJsonApi,
  validateJsonApiBaseUrl,
  validateJsonApiResource,
  JsonApiAdapterError,
} from "./jsonapi-adapter";

const slug = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const capabilitiesSchema = z.object({
  list: z.boolean().default(true),
  read: z.boolean().default(true),
  create: z.boolean().default(false),
  update: z.boolean().default(false),
  delete: z.boolean().default(false),
  schema: z.literal(false).default(false),
  customFields: z.literal(false).default(false),
});
const readOnly: CollectionCapabilities = {
  list: true,
  read: true,
  create: false,
  update: false,
  delete: false,
  schema: false,
  customFields: false,
};
const QUERYABLE_DOMAIN_RECORD_LIMIT = 10_000;
const QUERYABLE_DOMAIN_PAGE_SIZE = 500;
const optionsSchema = z
  .object({
    supportsFilters: z.boolean().optional(),
    supportsSort: z.boolean().optional(),
    allowFilters: z.boolean().optional(),
    allowSort: z.boolean().optional(),
    totalPointer: z.string().max(300).optional(),
  })
  .strict();
const sourceSchema = z.union([
  z
    .object({
      id: slug,
      label: z.string().trim().min(1).max(100),
      kind: z.literal("jsonapi"),
      baseUrl: z.string().max(2000),
      token: z.string().max(10000).optional(),
      options: optionsSchema.optional(),
    })
    .strict(),
  databaseSourceInputSchema,
]);
const sourceInspectionSchema = z
  .object({
    resource: z.string().max(300).optional(),
    resourceType: z.string().max(100).optional(),
  })
  .strict();
const bindingSchema = z
  .object({
    name: slug,
    label: z.string().trim().min(1).max(100),
    domain: z.string().max(100).optional(),
    collection: z.string().max(100).optional(),
    sourceId: z.string().max(120).optional(),
    resource: z.string().max(300).optional(),
    resourceType: z.string().max(100).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    relationships: z
      .record(
        z.string(),
        z.object({
          type: z.string().min(1).max(100),
          multiple: z.boolean().optional(),
        }),
      )
      .optional(),
    capabilities: capabilitiesSchema.optional(),
    idColumn: z.string().optional(),
    idType: z.enum(["string", "objectId"]).optional(),
  })
  .strict();
type SourceRow = {
  id: string;
  label: string;
  kind: "jsonapi" | DatabaseKind;
  config: string;
  encrypted_secret: string | null;
};
type BindingConfig = CollectionBindingMetadata & {
  operations?: OperationMap;
  bindingId?: string;
  fieldPaths?: Record<string, string[]>;
  resourceType?: string;
  relationships?: Record<string, { type: string; multiple?: boolean }>;
  /** Postgres v1: columna que actúa como identificador del registro. */
  idColumn?: string;
  primaryKey?: string[];
};
type BindingRow = {
  object_name: string;
  source_id: string;
  resource: string;
  config: string;
};
const reserved = new Set([
  "id",
  "type",
  "_version",
  "_relationships",
  "created_at",
  "updated_at",
  "deleted_at",
  "tenant_id",
]);
function fail(
  message: string,
  status: 400 | 404 | 405 | 409 | 422 | 500 | 502 | 503 | 504 = 422,
): never {
  throw new HTTPException(status, { message });
}
const context = (tenant: string, id: string) =>
  `${tenant}:collection-source:${id}`;
const expose = (row: SourceRow) => ({
  id: row.id,
  label: row.label,
  kind: row.kind,
  ...JSON.parse(row.config),
  ...(isDatabaseKind(row.kind)
    ? { hasPassword: Boolean(row.encrypted_secret) }
    : { hasToken: Boolean(row.encrypted_secret) }),
});
/** Capacidades fijas Postgres v1: lectura live, sin escrituras ni DDL. */
const postgresCapabilities: CollectionCapabilities = {
  ...readOnly,
  search: true,
  filter: true,
  sort: true,
};
async function binding(db: D1Database, tenant: string, name: string) {
  return db
    .prepare(
      "SELECT * FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
    )
    .bind(tenant, name)
    .first<BindingRow>();
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const plain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fieldLabel = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
const sourceFieldType = (value: unknown) =>
  typeof value === "boolean"
    ? "Toggle"
    : typeof value === "number" && Number.isFinite(value)
      ? "Number"
      : value !== null && typeof value === "object"
        ? "Textarea"
        : "Textbox";
function sourceInspection(
  result: Awaited<ReturnType<typeof executeJsonApi>>,
  resourceType?: string,
) {
  const sample = Array.isArray(result.data) ? result.data[0] : undefined;
  if (!sample) fail("El recurso no tiene registros para analizar.");
  const fields = Object.fromEntries(
    Object.entries(sample).flatMap(([key, value]) =>
      ["id", "type", "_relationships"].includes(key)
        ? []
        : [[key, { label: fieldLabel(key), type: sourceFieldType(value) }]],
    ),
  );
  const relationships: Record<string, { type: string; multiple?: boolean }> =
    {};
  if (plain(sample._relationships))
    for (const [key, value] of Object.entries(sample._relationships)) {
      const links = Array.isArray(value) ? value : value ? [value] : [];
      const types = new Set(
        links.flatMap((link) =>
          plain(link) && typeof link.type === "string" ? [link.type] : [],
        ),
      );
      if (types.size !== 1) continue;
      fields[key] = { label: fieldLabel(key), type: "Textbox" };
      relationships[key] = {
        type: [...types][0],
        ...(Array.isArray(value) ? { multiple: true } : {}),
      };
    }
  return {
    resourceType:
      resourceType ?? (typeof sample.type === "string" ? sample.type : ""),
    fields,
    relationships,
    ...(result.total === undefined ? {} : { total: result.total }),
    ...(result.hasNext === undefined ? {} : { hasNext: result.hasNext }),
  };
}
function fieldContract(field: any) {
  const { label, description, hidden, ...rest } = field;
  return canonical({
    ...rest,
    config: Object.fromEntries(
      Object.entries(field.config ?? {}).filter(
        ([key]) =>
          !["width", "section", "step", "collectionOptions"].includes(key),
      ),
    ),
  });
}
function inferFields(document?: DomainDocument) {
  const fields: Record<string, any> = {},
    paths: Record<string, string[]> = {};
  function add(path: string[], value: unknown) {
    let key = path
      .join("_")
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 42);
    if (!/^[a-z]/.test(key)) key = `field_${key}`.slice(0, 42);
    const base = key;
    let n = 1;
    while (fields[key] || reserved.has(key)) key = `${base}_${n++}`;
    fields[key] = {
      label: path.join(" · "),
      type:
        typeof value === "boolean"
          ? "Toggle"
          : typeof value === "number"
            ? "Number"
            : value && typeof value === "object"
              ? "Textarea"
              : "Textbox",
      readOnly: true,
    };
    paths[key] = path;
  }
  function walk(value: unknown, path: string[]) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      path.length < 4
    ) {
      for (const [key, v] of Object.entries(value)) walk(v, [...path, key]);
    } else add(path, value);
  }
  if (document)
    for (const [key, value] of Object.entries(document.attributes))
      walk(value, [key]);
  if (!Object.keys(fields).length) {
    fields.attributes = {
      label: "Atributos",
      type: "Textarea",
      readOnly: true,
    };
    paths.attributes = [];
  }
  return { fields, paths };
}
function flatten(
  document: DomainDocument,
  config: BindingConfig,
  provider: CollectionDomainProvider,
) {
  const values: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(config.fieldPaths ?? {})) {
    const value = provider.readDomainPath(document, path);
    values[key] =
      value && typeof value === "object"
        ? JSON.stringify(value)
        : (value ?? null);
  }
  return { ...values, id: document.id };
}
function parseBoundDomainFilters(
  raw: string | undefined,
  object: StudioObject,
) {
  if (!raw) return { logic: "and" as const, conditions: [] };
  const parsed = filterSchema.parse(JSON.parse(raw));
  const textOps = new Set(["contains", "startsWith", "endsWith"]);
  if (
    parsed.conditions.some((condition) => {
      if (!object.config.fields[condition.field]) return true;
      if (condition.op === "empty") return false;
      if (textOps.has(condition.op)) return typeof condition.value !== "string";
      return (
        !["string", "number", "boolean"].includes(typeof condition.value) &&
        condition.value !== null
      );
    })
  )
    fail("Filtro inválido para esta colección.");
  return { logic: parsed.logic, conditions: parsed.conditions };
}
function matchesBoundDomainFilter(
  row: Record<string, unknown>,
  condition: { field: string; op: string; value?: unknown },
) {
  const actual = row[condition.field];
  const expected = condition.value;
  if (condition.op === "empty") {
    return (
      actual == null ||
      actual === "" ||
      (Array.isArray(actual) && actual.length === 0)
    );
  }
  if (condition.op === "in") {
    return Array.isArray(expected) && expected.includes(actual);
  }
  const textActual = String(actual ?? "").toLocaleLowerCase("es-CO");
  const textExpected = String(expected ?? "").toLocaleLowerCase("es-CO");
  switch (condition.op) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && actual > Number(expected);
    case "gte":
      return typeof actual === "number" && actual >= Number(expected);
    case "lt":
      return typeof actual === "number" && actual < Number(expected);
    case "lte":
      return typeof actual === "number" && actual <= Number(expected);
    case "contains":
      return textActual.includes(textExpected);
    case "startsWith":
      return textActual.startsWith(textExpected);
    case "endsWith":
      return textActual.endsWith(textExpected);
    default:
      return false;
  }
}
function parseDomainSearchFields(
  object: StudioObject,
  params: Record<string, string | undefined>,
) {
  if (params.searchFields) {
    const fields = params.searchFields
      .split(",")
      .map((field) => field.trim())
      .filter((field) => object.config.fields[field] || field === "id");
    if (fields.length > 20) fail("Demasiados campos de búsqueda.");
    return fields;
  }
  if (
    params.searchField &&
    (object.config.fields[params.searchField] || params.searchField === "id")
  )
    return [params.searchField];
  return [];
}
function queryBoundDomainRows(
  rows: Record<string, unknown>[],
  filters: Array<{ field: string; op: string; value?: unknown }>,
  query: string | undefined,
  searchFields: string[],
  sort: string | undefined,
  order: "ASC" | "DESC",
  logic: "and" | "or" = "and",
) {
  const normalizedQuery = query?.trim().toLocaleLowerCase("es-CO");
  const filtered = rows.filter(
    (row) =>
      (filters.length === 0 ||
        (logic === "and"
          ? filters.every((condition) =>
              matchesBoundDomainFilter(row, condition),
            )
          : filters.some((condition) =>
              matchesBoundDomainFilter(row, condition),
            ))) &&
      (!normalizedQuery ||
        (searchFields.length
          ? searchFields.some((field) =>
              String(row[field] ?? "")
                .toLocaleLowerCase("es-CO")
                .includes(normalizedQuery),
            )
          : Object.values(row).some((value) =>
              String(value ?? "")
                .toLocaleLowerCase("es-CO")
                .includes(normalizedQuery),
            ))),
  );
  if (!sort) return filtered;
  return [...filtered].sort((left, right) => {
    const result = compareBoundDomainValues(left[sort], right[sort]);
    const ordered = order === "DESC" ? -result : result;
    return ordered || String(left.id).localeCompare(String(right.id), "es-CO");
  });
}
function compareBoundDomainValues(left: unknown, right: unknown) {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return new Intl.Collator("es-CO", {
    numeric: true,
    sensitivity: "base",
  }).compare(String(left), String(right));
}
async function queryableDomainRows(
  db: D1Database,
  collection: DomainCollection,
  config: BindingConfig,
  object: StudioObject,
  params: Record<string, string | undefined>,
  provider: CollectionDomainProvider,
) {
  const { logic, conditions } = parseBoundDomainFilters(params.filters, object);
  const searchFields = parseDomainSearchFields(object, params);
  const sort =
    params.sort && params.sort !== "updated_at" ? params.sort : undefined;
  if (sort && !object.config.fields[sort] && sort !== "id")
    fail("Campo de orden desconocido.");
  const documents: DomainDocument[] = [];
  for (
    let offset = 0;
    offset < QUERYABLE_DOMAIN_RECORD_LIMIT;
    offset += QUERYABLE_DOMAIN_PAGE_SIZE
  ) {
    const page = await collection.list(db, {
      limit: QUERYABLE_DOMAIN_PAGE_SIZE,
      offset,
    });
    documents.push(...page.data);
    if (page.data.length < QUERYABLE_DOMAIN_PAGE_SIZE) break;
  }
  if (documents.length === QUERYABLE_DOMAIN_RECORD_LIMIT) {
    const probe = await collection.list(db, {
      limit: 1,
      offset: QUERYABLE_DOMAIN_RECORD_LIMIT,
    });
    if (probe.data.length)
      fail(
        "Esta colección supera el límite de 10.000 registros para filtrar u ordenar.",
        405,
      );
  }
  return queryBoundDomainRows(
    documents.map((document) => flatten(document, config, provider)),
    conditions,
    params.q,
    searchFields,
    sort,
    params.order === "ASC" ? "ASC" : "DESC",
    logic,
  );
}
function csvCell(value: unknown) {
  let text =
    value === null || value === undefined
      ? ""
      : Array.isArray(value) || typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csvRequest(
  params: Record<string, string | undefined>,
  object: StudioObject,
) {
  const columns = z
    .array(slug)
    .min(1)
    .max(100)
    .parse(JSON.parse(params.columns ?? "[]"));
  const headers = z
    .array(z.string().trim().min(1).max(100))
    .length(columns.length)
    .parse(JSON.parse(params.headers ?? "[]"));
  if (columns.some((key) => !object.config.fields[key]))
    fail("El CSV contiene una columna no declarada.");
  return { columns, headers };
}
export async function handlesCollectionSourceRequest(
  db: D1Database,
  tenant: string,
  path: string,
) {
  const normalized = decodeURIComponent(path);
  if (
    /^\/api\/(sources|collection-catalog|collection-bindings|collection-options)(\/|$)/.test(
      normalized,
    )
  )
    return true;
  const segment = normalized.match(
    /^\/api\/(?:objects|records|record-detail|record-activity|record-notes|files|import|export|views)\/([^/]+)/,
  )?.[1];
  if (segment && (await binding(db, tenant, segment))) return true;
  return false;
}

/** Outer domain gateway must require platform-admin for connection/binding operations. */
export function createCollectionSourceApp(
  db: D1Database,
  files: R2Bucket,
  tenant: string,
  principalId: string,
  integrationKey?: string,
  fetcher?: typeof fetch,
  provider: CollectionDomainProvider = emptyCollectionDomainProvider,
  sqlBridge?: SqlBridgeClient,
  databaseBridge: DatabaseBridgeClient | undefined = sqlBridge?.database,
) {
  const databases = createDatabaseSourceService({
    tenant,
    principalId,
    integrationKey,
    bridge: databaseBridge,
  });
  const supportsBoundDomainQuery = (config: BindingConfig) =>
    config.kind === "domain" &&
    provider.isQueryableCollection(config.domain, config.collection);
  /** Conexión Postgres lista para el puente (contraseña descifrada). */
  const postgresConnection = async (
    row: SourceRow,
  ): Promise<BridgeConnectionWithPassword> => {
    const { writeEnabled: _writeEnabled, ...legacyConfig } = JSON.parse(
      row.config,
    );
    const parsed = postgresSourceConfigSchema.parse(legacyConfig);
    if (!sqlBridge) fail("El puente SQL no está disponible.", 503);
    const password = row.encrypted_secret
      ? await decryptSecret(
          row.encrypted_secret,
          integrationKey,
          context(JSON.stringify([tenant, principalId]), row.id),
        )
      : "";
    if (!password) fail("Esta fuente no tiene contraseña configurada.", 422);
    return { ...parsed, password };
  };
  const requireSqlBridge = (): SqlBridgeClient => {
    if (!sqlBridge) fail("El puente SQL no está disponible.", 503);
    return sqlBridge;
  };
  /** Inspección Postgres: sin recurso lista tablas; con recurso describe columnas. */
  const inspectPostgres = async (row: SourceRow, resource?: string) => {
    const bridge = requireSqlBridge();
    const connection = await postgresConnection(row);
    if (!resource) {
      const tables: BridgeTable[] = await bridge.listTables(connection);
      return { tables };
    }
    const table = sqlIdentifier.parse(resource);
    const described = await bridge.getColumns(connection, table);
    return {
      resourceType: table,
      fields: Object.fromEntries(
        described.columns.map((column) => [
          column.name,
          {
            label: postgresFieldLabel(column.name),
            ...postgresTypeToFieldType(column.pgType),
          },
        ]),
      ),
      relationships: {},
      primaryKey: described.primaryKey,
      kind: described.kind,
    };
  };
  const app = new Hono();
  const generic = createStudioApp(tenant, { principalId });
  const fallback = (request: Request) =>
    generic.fetch(request, {
      DB: db,
      FILES: files,
      POC_LOCAL: "false",
      INTEGRATION_KEY: integrationKey,
    });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: "Máximo 1 MB por solicitud." }, 413),
    }),
  );
  app.onError((e, c) => {
    if (e instanceof DatabaseBridgeError)
      return c.json(
        {
          error: e.message,
          code: e.code,
          ...(e.outcome ? { outcome: e.outcome } : {}),
        },
        e.status,
      );
    if (e instanceof DomainCommandError)
      return c.json(
        { error: e.message },
        e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 422,
      );
    if (e instanceof HTTPException)
      return c.json({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return c.json({ error: e.message }, 422);
    if (e instanceof JsonApiAdapterError)
      return c.json({ error: e.message }, e.status as 400);
    if (e instanceof SqlBridgeError)
      return c.json({ error: e.message }, e.status);
    if (isUniqueConstraint(e))
      return c.json({ error: "Este identificador ya existe." }, 409);
    console.error(e);
    return c.json(
      { error: "No se pudo completar la operación de colección." },
      500,
    );
  });
  app.get("/api/sources", async (c) => {
    const rows = await db
      .prepare(
        "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND owner_principal_id=? ORDER BY label,id",
      )
      .bind(tenant, principalId)
      .all<SourceRow>();
    return c.json({ data: rows.results.map(expose) });
  });
  app.post("/api/sources", async (c) => {
    const input = sourceSchema.parse(await c.req.json());
    if (input.kind !== "jsonapi") {
      const config = databaseSourceConfigFromInput(input);
      const encrypted = input.password
        ? await encryptSecret(
            input.password,
            integrationKey,
            context(JSON.stringify([tenant, principalId]), input.id),
          )
        : null;
      const stored = JSON.stringify(config);
      try {
        await db
          .prepare(
            "INSERT INTO crm_collection_sources(tenant_id,id,label,kind,config,encrypted_secret,owner_principal_id) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            tenant,
            input.id,
            input.label,
            input.kind,
            stored,
            encrypted,
            principalId,
          )
          .run();
      } catch (error) {
        if (isUniqueConstraint(error))
          fail("Ya existe una fuente con ese identificador.", 409);
        throw error;
      }
      return c.json(
        {
          data: expose({
            id: input.id,
            label: input.label,
            kind: input.kind,
            config: stored,
            encrypted_secret: encrypted,
          }),
        },
        201,
      );
    }
    const baseUrl = validateJsonApiBaseUrl(input.baseUrl).toString();
    const options = {
      supportsFilters:
        input.options?.supportsFilters ?? input.options?.allowFilters ?? false,
      supportsSort:
        input.options?.supportsSort ?? input.options?.allowSort ?? false,
      ...(input.options?.totalPointer
        ? { totalPointer: input.options.totalPointer }
        : {}),
    };
    const encrypted = input.token
      ? await encryptSecret(
          input.token,
          integrationKey,
          context(JSON.stringify([tenant, principalId]), input.id),
        )
      : null;
    const config = JSON.stringify({ baseUrl, options });
    await db
      .prepare(
        "INSERT INTO crm_collection_sources(tenant_id,id,label,kind,config,encrypted_secret,owner_principal_id) VALUES (?,?,?,'jsonapi',?,?,?)",
      )
      .bind(tenant, input.id, input.label, config, encrypted, principalId)
      .run();
    return c.json(
      {
        data: expose({
          id: input.id,
          label: input.label,
          kind: "jsonapi",
          config,
          encrypted_secret: encrypted,
        }),
      },
      201,
    );
  });
  app.put("/api/sources/:id", async (c) => {
    const input = z
      .object({
        token: z.string().max(10000).nullable().optional(),
        password: z.string().max(10000).nullable().optional(),
        label: z.string().trim().min(1).max(100).optional(),
        writeEnabled: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const row = await db
      .prepare(
        "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
      )
      .bind(tenant, c.req.param("id"), principalId)
      .first<SourceRow>();
    if (!row) fail("Fuente no encontrada.", 404);
    if (isDatabaseKind(row.kind) && input.token !== undefined)
      fail("Esta fuente usa contraseña, no token.");
    if (row.kind === "jsonapi" && input.password !== undefined)
      fail("Esta fuente usa token, no contraseña.");
    const secretInput = isDatabaseKind(row.kind) ? input.password : input.token;
    const encrypted =
      secretInput === undefined
        ? row.encrypted_secret
        : secretInput
          ? await encryptSecret(
              secretInput,
              integrationKey,
              context(JSON.stringify([tenant, principalId]), row.id),
            )
          : null;
    if (row.kind === "jsonapi" && input.writeEnabled !== undefined)
      fail("Database write policy does not apply to JSON:API.");
    const storedConfig =
      input.writeEnabled === undefined
        ? row.config
        : JSON.stringify({
            ...JSON.parse(row.config),
            writeEnabled: input.writeEnabled,
          });
    const changes: D1PreparedStatement[] = [
      db
        .prepare(
          "UPDATE crm_collection_sources SET config=?,label=?,encrypted_secret=? WHERE tenant_id=? AND id=? AND owner_principal_id=?",
        )
        .bind(
          storedConfig,
          input.label ?? row.label,
          encrypted,
          tenant,
          row.id,
          principalId,
        ),
    ];
    if (isDatabaseKind(row.kind) && input.writeEnabled !== undefined) {
      const linked = await db
        .prepare(
          "SELECT b.object_name,b.config,o.config AS object_config,o.version FROM crm_collection_bindings b JOIN crm_objects o ON o.tenant_id=b.tenant_id AND o.name=b.object_name WHERE b.tenant_id=? AND b.source_id=?",
        )
        .bind(tenant, row.id)
        .all<{
          object_name: string;
          config: string;
          object_config: string;
          version: number;
        }>();
      for (const linkedRow of linked.results) {
        const config = JSON.parse(linkedRow.config) as BindingConfig;
        if (
          config.sourceOwnerPrincipalId !== principalId ||
          !config.databaseMetadata
        )
          continue;
        const capabilities = deriveDatabaseCapabilities(
          config.databaseMetadata,
          input.writeEnabled && !config.schemaIssues?.length,
          config.idColumn,
        );
        if (config.writePermissions)
          for (const action of ["create", "update", "delete"] as const)
            capabilities[action] =
              capabilities[action] && config.writePermissions[action];
        config.capabilities = capabilities;
        const definition = JSON.parse(linkedRow.object_config);
        definition.studio = {
          ...definition.studio,
          collection: config,
          capabilities,
        };
        const g = guard(
          db,
          "SELECT version=? FROM crm_objects WHERE tenant_id=? AND name=?",
          [linkedRow.version, tenant, linkedRow.object_name],
        );
        changes.push(
          g.start,
          db
            .prepare(
              "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
            )
            .bind(JSON.stringify(config), tenant, linkedRow.object_name),
          db
            .prepare(
              "UPDATE crm_objects SET config=?,version=version+1 WHERE tenant_id=? AND name=?",
            )
            .bind(JSON.stringify(definition), tenant, linkedRow.object_name),
          g.end,
        );
      }
    }
    await transaction(db, changes);
    return c.json({
      data: expose({
        ...row,
        config: storedConfig,
        label: input.label ?? row.label,
        encrypted_secret: encrypted,
      }),
    });
  });
  app.post("/api/sources/:id/test", async (c) => {
    const row = await db
      .prepare(
        "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
      )
      .bind(tenant, c.req.param("id"), principalId)
      .first<SourceRow>();
    if (!row) fail("Source not found.", 404);
    if (!isDatabaseKind(row.kind))
      fail("Connection testing is only available for database sources.");
    await databases.test(row as DatabaseSourceRow);
    return c.json({ data: { ok: true } });
  });
  app.post("/api/sources/:id/inspect", async (c) => {
    const input = sourceInspectionSchema.parse(await c.req.json());
    const row = await db
      .prepare(
        "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
      )
      .bind(tenant, c.req.param("id"), principalId)
      .first<SourceRow>();
    if (!row) fail("Fuente no encontrada.", 404);
    if (isDatabaseKind(row.kind) && databaseBridge)
      return c.json({
        data: await databases.inspection(
          row as DatabaseSourceRow,
          input.resource,
        ),
      });
    if (isDatabaseKind(row.kind) && row.kind !== "postgres")
      fail("Database bridge unavailable.", 503);
    if (row.kind === "postgres")
      return c.json({ data: await inspectPostgres(row, input.resource) });
    if (!input.resource) fail("Indica el recurso a inspeccionar.");
    const config = JSON.parse(row.config) as {
      baseUrl: string;
      options?: {
        supportsFilters?: boolean;
        supportsSort?: boolean;
        totalPointer?: string;
      };
    };
    const resource = validateJsonApiResource(input.resource);
    const token = row.encrypted_secret
      ? await decryptSecret(
          row.encrypted_secret,
          integrationKey,
          context(JSON.stringify([tenant, principalId]), row.id),
        )
      : undefined;
    const result = await executeJsonApi(
      {
        source: {
          baseUrl: config.baseUrl,
          ...(token ? { token } : {}),
          supportsFilters: Boolean(config.options?.supportsFilters),
          supportsSort: Boolean(config.options?.supportsSort),
          ...(config.options?.totalPointer
            ? { totalPointer: config.options.totalPointer }
            : {}),
        },
        resource,
        ...(input.resourceType ? { resourceType: input.resourceType } : {}),
        operation: "list",
        query: { page: 1, perPage: 1 },
      },
      fetcher,
    );
    return c.json({ data: sourceInspection(result, input.resourceType) });
  });
  app.delete("/api/sources/:id", async (c) => {
    const id = c.req.param("id");
    const owned = await db
      .prepare(
        "SELECT 1 FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
      )
      .bind(tenant, id, principalId)
      .first();
    if (!owned) fail("Fuente no encontrada.", 404);
    const g = guard(
      db,
      "SELECT count(*)=0 FROM crm_collection_bindings WHERE tenant_id=? AND source_id=?",
      [tenant, id],
    );
    await transaction(db, [
      g.start,
      db
        .prepare(
          "DELETE FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
        )
        .bind(tenant, id, principalId),
      g.end,
    ]);
    return c.json({ data: { id, deleted: true } });
  });
  app.delete("/api/collection-bindings/:name", async (c) => {
    const name = c.req.param("name");
    const row = await binding(db, tenant, name);
    if (!row) fail("Enlace no encontrado.", 404);
    const empty = guard(
      db,
      "SELECT count(*)=0 FROM crm_records WHERE tenant_id=? AND object_name=?",
      [tenant, name],
    );
    await transaction(db, [
      empty.start,
      db
        .prepare(
          "DELETE FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
        )
        .bind(tenant, name),
      db
        .prepare(
          "DELETE FROM crm_schema_versions WHERE tenant_id=? AND object_name=?",
        )
        .bind(tenant, name),
      db
        .prepare("DELETE FROM crm_views WHERE tenant_id=? AND object_name=?")
        .bind(tenant, name),
      db
        .prepare("DELETE FROM crm_objects WHERE tenant_id=? AND name=?")
        .bind(tenant, name),
      audit(db, tenant, "collection.unbound", name, null, {
        sourceId: row.source_id,
        resource: row.resource,
      }),
      empty.end,
    ]);
    return c.json({ data: { name, unbound: true } });
  });
  app.route(
    "/api/collection-bindings",
    createCollectionOperationsApp(db, tenant, provider),
  );
  app.get("/api/collection-options/:object/:field", async (c) => {
    const object = await getObject(db, tenant, c.req.param("object"));
    const source =
      object.config.fields[c.req.param("field")]?.config?.collectionOptions;
    if (!source) fail("Este campo no tiene una colección de opciones.", 404);
    if (
      !(await provider.collectionsForTenant(db, tenant)).some(
        (entry) =>
          entry.descriptor.domain === (source as { domain?: string }).domain &&
          entry.descriptor.collection ===
            (source as { collection?: string }).collection,
      )
    )
      fail("Colección no disponible.", 404);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query("page") ?? 1);
    c.header("Cache-Control", "no-store");
    return c.json(await loadCollectionOptions(db, source, page, provider));
  });
  app.get("/api/collection-catalog", async (c) =>
    c.json({
      data: (await provider.collectionsForTenant(db, tenant)).map((entry) => ({
        ...entry.descriptor,
        capabilities: {
          ...readOnly,
          ...(provider.domainWriteContract(
            tenant,
            entry.descriptor.domain,
            entry.descriptor.collection,
          )
            ? { create: true, update: true, delete: true }
            : {}),
          search:
            provider.isQueryableCollection(
              entry.descriptor.domain,
              entry.descriptor.collection,
            ) || Boolean(entry.listQuerySchema?.shape.q),
          filter: provider.isQueryableCollection(
            entry.descriptor.domain,
            entry.descriptor.collection,
          ),
          sort: provider.isQueryableCollection(
            entry.descriptor.domain,
            entry.descriptor.collection,
          ),
        },
      })),
    }),
  );
  app.get("/api/collection-bindings", async (c) => {
    const rows = await db
      .prepare(
        "SELECT b.*,o.label FROM crm_collection_bindings b JOIN crm_objects o ON o.tenant_id=b.tenant_id AND o.name=b.object_name WHERE b.tenant_id=? ORDER BY o.label",
      )
      .bind(tenant)
      .all<BindingRow & { label: string }>();
    return c.json({
      data: rows.results.map((row) => ({
        name: row.object_name,
        label: row.label,
        ...JSON.parse(row.config),
      })),
    });
  });
  app.post("/api/collection-bindings", async (c) => {
    const input = bindingSchema.parse(await c.req.json());
    if (
      await db
        .prepare("SELECT 1 FROM crm_objects WHERE tenant_id=? AND name=?")
        .bind(tenant, input.name)
        .first()
    )
      fail("El objeto ya existe; no se sobrescribirá su almacenamiento.", 409);
    let config: BindingConfig;
    let fields: Record<string, unknown>;
    if (input.domain || input.collection) {
      if (
        !input.domain ||
        !input.collection ||
        input.sourceId ||
        input.resource
      )
        fail("Selecciona una colección de dominio o una fuente JSON:API.");
      const collection = (await provider.collectionsForTenant(db, tenant)).find(
        (entry) =>
          entry.descriptor.domain === input.domain &&
          entry.descriptor.collection === input.collection,
      );
      if (!collection) fail("Colección de dominio no encontrada.", 404);
      if (
        input.capabilities &&
        Object.entries(input.capabilities).some(
          ([key, value]) =>
            value &&
            !{
              ...readOnly,
              ...(provider.domainWriteContract(
                tenant,
                input.domain,
                input.collection,
              )
                ? { create: true, update: true, delete: true }
                : {}),
            }[key as keyof CollectionCapabilities],
        )
      )
        fail("Esta colección de dominio solo admite lectura.");
      const sample = await collection.list(db, { limit: 1, offset: 0 });
      const inferred = inferFields(sample.data[0]);
      fields = inferred.fields;
      config = {
        kind: "domain",
        sourceId: `domain:${input.domain}`,
        resource: input.collection,
        domain: input.domain,
        collection: input.collection,
        capabilities: {
          ...readOnly,
          search:
            provider.isQueryableCollection(input.domain, input.collection) ||
            Boolean(collection.listQuerySchema?.shape.q),
          filter: provider.isQueryableCollection(
            input.domain,
            input.collection,
          ),
          sort: provider.isQueryableCollection(input.domain, input.collection),
        },
        fieldPaths: inferred.paths,
      };
      provider.configureDomainWrites(tenant, config, fields);
    } else {
      if (
        !input.sourceId ||
        !input.resource ||
        !input.fields ||
        !Object.keys(input.fields).length
      )
        fail("Selecciona fuente, recurso y campos explícitos.");
      const storedSource = await db
        .prepare(
          "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
        )
        .bind(tenant, input.sourceId, principalId)
        .first<SourceRow>();
      if (!storedSource) fail("Fuente no encontrada.", 404);
      if (isDatabaseKind(storedSource.kind) && databaseBridge) {
        if (input.relationships && Object.keys(input.relationships).length)
          fail("Database relationships are not supported.");
        const metadata = await databases.inspect(
          storedSource as DatabaseSourceRow,
          input.resource,
        );
        if (
          storedSource.kind === "mongodb" &&
          !metadata.fields.length &&
          input.idType
        ) {
          metadata.idType = input.idType;
          metadata.fields = Object.keys(input.fields).map((name) => ({
            name,
            nativeType: "json",
            valueType: "json" as const,
            nullable: true,
            generated: name === "_id" && input.idType === "objectId",
            writable: name !== "_id" || input.idType === "string",
            hasDefault: name === "_id" && input.idType === "objectId",
          }));
        }
        const idColumn = resolveRecordKey(metadata, input.idColumn);
        if (idColumn && !input.fields[idColumn])
          fail(`Include identifier field ${idColumn}.`);
        const live = new Map(metadata.fields.map((f) => [f.name, f]));
        fields = Object.fromEntries(
          Object.entries(input.fields).map(([key, value]) => {
            const native = live.get(key);
            if (!native) fail(`Unknown field ${key}.`);
            return [
              key,
              {
                ...(value as object),
                ...databaseFieldInterface(native),
                label: (value as any)?.label ?? key,
              },
            ];
          }),
        );
        const capabilities = deriveDatabaseCapabilities(
          metadata,
          Boolean(JSON.parse(storedSource.config).writeEnabled),
          idColumn,
        );
        if (input.capabilities)
          for (const operation of ["create", "update", "delete"] as const)
            capabilities[operation] =
              capabilities[operation] && input.capabilities[operation];
        config = {
          kind: storedSource.kind,
          sourceOwnerPrincipalId: principalId,
          writePermissions: input.capabilities
            ? {
                create: input.capabilities.create,
                update: input.capabilities.update,
                delete: input.capabilities.delete,
              }
            : undefined,
          sourceId: input.sourceId,
          resource: input.resource,
          capabilities,
          idColumn,
          idType: metadata.idType,
          primaryKey: metadata.primaryKey,
          databaseMetadata: metadata,
        };
      } else if (
        isDatabaseKind(storedSource.kind) &&
        storedSource.kind !== "postgres"
      ) {
        fail("Database bridge unavailable.", 503);
      } else if (storedSource.kind === "postgres") {
        if (input.resourceType)
          fail("Postgres no usa tipos de recurso JSON:API.");
        if (input.relationships && Object.keys(input.relationships).length)
          fail(
            "Postgres v1 no mapea relaciones remotas; usa relaciones locales.",
          );
        if (
          input.capabilities &&
          (input.capabilities.create ||
            input.capabilities.update ||
            input.capabilities.delete)
        )
          fail("Esta colección Postgres es de solo lectura.");
        const table = sqlIdentifier.parse(input.resource);
        // Validar contra el esquema vivo: columnas reales, PK de 1 columna.
        const described = await requireSqlBridge().getColumns(
          await postgresConnection(storedSource),
          table,
        );
        const live = new Map(
          described.columns.map((column) => [column.name, column]),
        );
        for (const key of Object.keys(input.fields)) {
          sqlIdentifier.parse(key);
          if (!live.has(key)) fail(`Columna inexistente en ${table}: ${key}.`);
        }
        if (described.primaryKey.length !== 1)
          fail(
            "La tabla requiere una primary key de una sola columna para enlazarse.",
          );
        const idColumn = described.primaryKey[0];
        if (!input.fields[idColumn])
          fail(`Incluye la columna identificadora: ${idColumn}.`);
        fields = input.fields;
        config = {
          kind: "postgres",
          sourceId: input.sourceId,
          resource: table,
          capabilities: { ...postgresCapabilities },
          idColumn,
          primaryKey: described.primaryKey,
        };
      } else {
        const sourceOptions = JSON.parse(storedSource.config).options;
        const resource = validateJsonApiResource(input.resource);
        fields = input.fields;
        config = {
          kind: "jsonapi",
          sourceId: input.sourceId,
          resource,
          capabilities: {
            ...(input.capabilities ?? readOnly),
            search: false,
            filter: Boolean(sourceOptions?.supportsFilters),
            sort: Boolean(sourceOptions?.supportsSort),
          },
          ...(input.resourceType ? { resourceType: input.resourceType } : {}),
          ...(input.relationships
            ? { relationships: input.relationships }
            : {}),
        };
      }
    }
    config.bindingId = crypto.randomUUID();
    for (const key of Object.keys(fields))
      // En Postgres la PK suele llamarse `id` y coincide con el
      // identificador del sobre; el resto de reservadas sigue bloqueado.
      if (reserved.has(key) && !(isDatabaseKind(config.kind) && key === "id"))
        fail(`Campo reservado: ${key}.`);
    const definition = objectSchema.parse({
      name: input.name,
      label: input.label,
      description: "",
      config: {
        version: 2,
        fields,
        fieldOrder: Object.keys(fields),
        studio: { collection: config, capabilities: config.capabilities },
      },
    }) as StudioObject;
    for (const [key, field] of Object.entries(definition.config.fields)) {
      if (
        field.config?.relation ||
        field.config?.formula ||
        field.computedValue ||
        field.rules?.length ||
        field.config?.unique
      )
        fail(
          "Los campos enlazados no admiten relaciones locales, cálculos ni unicidad local.",
        );
      if (
        config.relationships?.[key] &&
        field.type !== "Textbox" &&
        field.type !== "Dropdown"
      )
        fail(
          "Los identificadores de relaciones requieren un campo de texto o selección.",
        );
    }
    for (const key of Object.keys(config.relationships ?? {}))
      if (!definition.config.fields[key])
        fail("Toda relación debe tener un campo explícito.");
    const sourceGuard =
      config.kind === "jsonapi" || isDatabaseKind(config.kind)
        ? guard(
            db,
            "SELECT 1 FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
            [tenant, config.sourceId, principalId],
          )
        : undefined;
    await transaction(db, [
      ...(sourceGuard ? [sourceGuard.start] : []),
      db
        .prepare(
          "INSERT INTO crm_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,1)",
        )
        .bind(
          tenant,
          input.name,
          input.label,
          definition.description,
          JSON.stringify(definition.config),
        ),
      db
        .prepare(
          "INSERT INTO crm_collection_bindings(tenant_id,object_name,source_id,resource,config) VALUES (?,?,?,?,?)",
        )
        .bind(
          tenant,
          input.name,
          config.sourceId,
          config.resource,
          JSON.stringify(config),
        ),
      db
        .prepare(
          "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,1,?)",
        )
        .bind(
          tenant,
          input.name,
          JSON.stringify({ ...definition, version: 1 }),
        ),
      audit(db, tenant, "collection.bound", input.name, null, config),
      ...(sourceGuard ? [sourceGuard.end] : []),
    ]);
    return c.json({ data: { ...definition, version: 1 } }, 201);
  });
  app.post("/api/collection-bindings/:name/sync", async (c) => {
    const input = z
      .object({
        version: z.number().int(),
        fields: z.array(z.string()).min(1).max(100).optional(),
      })
      .strict()
      .parse(await c.req.json());
    const name = c.req.param("name");
    const row = await binding(db, tenant, name);
    if (!row) fail("Binding not found.", 404);
    const config = JSON.parse(row.config) as BindingConfig;
    if (!isDatabaseKind(config.kind))
      fail("This binding does not use database metadata.", 405);
    if (
      config.sourceOwnerPrincipalId &&
      config.sourceOwnerPrincipalId !== principalId
    )
      fail("Source not available.", 404);
    const source = await db
      .prepare(
        "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
      )
      .bind(tenant, config.sourceId, principalId)
      .first<SourceRow>();
    if (!source) fail("Source not available.", 404);
    const object = await getObject(db, tenant, name);
    if (object.version !== input.version)
      fail("Collection changed. Reload before synchronizing.", 409);
    const metadata = await databases.inspect(
      source as DatabaseSourceRow,
      config.resource,
    );
    const selected = input.fields ?? Object.keys(object.config.fields);
    const issues: string[] = [];
    const fields = Object.fromEntries(
      selected.map((key) => {
        const native = metadata.fields.find((f) => f.name === key);
        const old = object.config.fields[key];
        if (!native) {
          issues.push(`Missing field: ${key}`);
          return [key, { ...old, readOnly: true }];
        }
        const previous = config.databaseMetadata?.fields.find(
          (f) => f.name === key,
        );
        if (
          !input.fields &&
          previous &&
          previous.nativeType !== native.nativeType
        )
          issues.push(`Changed type: ${key}`);
        return [
          key,
          {
            ...old,
            ...databaseFieldInterface(native),
            label: old?.label ?? key,
          },
        ];
      }),
    );
    const key = resolveRecordKey(metadata, config.idColumn);
    if (key && !selected.includes(key))
      fail(`Include identifier field ${key}.`);
    const capabilities = deriveDatabaseCapabilities(
      metadata,
      Boolean(JSON.parse(source.config).writeEnabled) && !issues.length,
      key,
    );
    const next = {
      ...config,
      idColumn: key,
      idType: metadata.idType,
      databaseMetadata: metadata,
      schemaIssues: issues,
      capabilities,
    };
    if (config.writePermissions)
      for (const action of ["create", "update", "delete"] as const)
        next.capabilities[action] =
          next.capabilities[action] && config.writePermissions[action];
    object.config.fields = fields;
    object.config.fieldOrder = selected;
    object.config.studio = {
      ...object.config.studio,
      collection: next,
      capabilities: next.capabilities,
    };
    const g = guard(
      db,
      "SELECT version=? FROM crm_objects WHERE tenant_id=? AND name=?",
      [input.version, tenant, name],
    );
    await transaction(db, [
      g.start,
      db
        .prepare(
          "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
        )
        .bind(JSON.stringify(next), tenant, name),
      db
        .prepare(
          "UPDATE crm_objects SET config=?,version=version+1 WHERE tenant_id=? AND name=?",
        )
        .bind(JSON.stringify(object.config), tenant, name),
      audit(db, tenant, "collection.metadata.synced", name, null, { issues }),
      g.end,
    ]);
    return c.json({ data: { ...object, version: input.version + 1 } });
  });
  app.all("/api/*", async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname),
      method = c.req.method;
    const matched = path.match(
      /^\/api\/(objects|records|record-detail|record-activity|record-notes|files|import|export|views)\/([^/]+)(?:\/(.*))?$/,
    );
    if (!matched) fail("Ruta de colección no encontrada.", 404);
    const [, surface, name, id] = matched;
    const row = await binding(db, tenant, name);
    if (!row) fail("Enlace no encontrado.", 404);
    const config = JSON.parse(row.config) as BindingConfig;
    if (
      config.kind === "domain" &&
      !(await provider.collectionsForTenant(db, tenant)).some(
        (entry) =>
          entry.descriptor.domain === config.domain &&
          entry.descriptor.collection === config.collection,
      )
    )
      fail("Colección no disponible.", 404);
    const object = await getObject(db, tenant, name);
    if (isDatabaseKind(config.kind) && databaseBridge) {
      if (
        config.sourceOwnerPrincipalId &&
        config.sourceOwnerPrincipalId !== principalId
      )
        fail("Source not available.", 404);
      const source = await db
        .prepare(
          "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
        )
        .bind(tenant, config.sourceId, principalId)
        .first<SourceRow>();
      if (!source) fail("Source not available.", 404);
      const metadata =
        config.databaseMetadata ??
        (await databases.inspect(source as DatabaseSourceRow, config.resource));
      config.capabilities = deriveDatabaseCapabilities(
        metadata,
        Boolean(JSON.parse(source.config).writeEnabled) &&
          !config.schemaIssues?.length,
        config.idColumn,
      );
      if (config.writePermissions)
        for (const action of ["create", "update", "delete"] as const)
          config.capabilities[action] =
            config.capabilities[action] && config.writePermissions[action];
      object.config.studio = {
        ...object.config.studio,
        collection: { ...config },
        capabilities: config.capabilities,
      };
    }
    if (surface === "objects") {
      if (method === "PATCH" && id === "screen") return fallback(c.req.raw);
      if (method === "GET" && (!id || id === "versions"))
        return !id ? c.json({ data: object }) : fallback(c.req.raw);
      if (
        (method === "PUT" && !id) ||
        (method === "POST" && id === "preview")
      ) {
        const body = await c.req.json<any>();
        const next = objectSchema.parse({
          ...(id === "preview" ? body.object : body),
          name,
        }) as StudioObject;
        if (
          JSON.stringify(canonical(next.config.studio?.collection)) !==
            JSON.stringify(canonical(object.config.studio?.collection)) ||
          (next.config.studio?.capabilities !== undefined &&
            JSON.stringify(canonical(next.config.studio.capabilities)) !==
              JSON.stringify(canonical(config.capabilities)))
        )
          fail(
            "La fuente y las capacidades del enlace no se pueden modificar desde el diseñador.",
          );
        if (
          JSON.stringify(Object.keys(next.config.fields).sort()) !==
          JSON.stringify(Object.keys(object.config.fields).sort())
        )
          fail("La colección no admite agregar ni eliminar campos.");
        for (const [key, field] of Object.entries(next.config.fields))
          if (
            JSON.stringify(fieldContract(field)) !==
            JSON.stringify(fieldContract(object.config.fields[key]))
          )
            fail(
              "El diseñador de una colección enlazada solo modifica etiquetas, visibilidad y distribución.",
            );
        if (
          Object.keys(body.migration?.rename ?? {}).length ||
          body.migration?.drop?.length ||
          body.migration?.coerce?.length
        )
          fail("La colección no admite migraciones locales.");
        if (id === "preview")
          return c.json({
            data: { valid: true, changed: 0, total: 0, errors: [] },
          });
        if (body.version !== object.version)
          fail("El diseño cambió; recarga antes de guardar.", 409);
        next.config.studio = {
          ...next.config.studio,
          capabilities: config.capabilities,
        };
        const definition = { ...next, version: (object.version ?? 1) + 1 };
        const g = guard(
          db,
          "SELECT version=? FROM crm_objects WHERE tenant_id=? AND name=?",
          [object.version, tenant, name],
        );
        await transaction(db, [
          g.start,
          db
            .prepare(
              "UPDATE crm_objects SET label=?,description=?,config=?,version=? WHERE tenant_id=? AND name=?",
            )
            .bind(
              next.label,
              next.description,
              JSON.stringify(next.config),
              definition.version,
              tenant,
              name,
            ),
          db
            .prepare(
              "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,?,?)",
            )
            .bind(tenant, name, definition.version, JSON.stringify(definition)),
          g.end,
        ]);
        return c.json({ data: definition });
      }
      fail(
        "La colección no admite cambios de esquema ni restauraciones locales.",
      );
    }
    if (surface === "views") return fallback(c.req.raw);
    if (
      ["import", "files", "record-notes"].includes(surface) ||
      id?.includes("/") ||
      id === "bulk" ||
      id === "summary"
    )
      fail("Operación no anunciada por esta colección.", 405);
    if (surface === "record-activity" && method === "GET") {
      if (!config.capabilities.read) fail("La colección no permite lectura.");
      return c.json({ data: [], total: 0, page: 1 });
    }
    const operation =
      method === "GET"
        ? id
          ? "read"
          : "list"
        : method === "POST" && !id
          ? "create"
          : method === "PATCH" && id
            ? "update"
            : method === "DELETE" && id
              ? "delete"
              : undefined;
    const params = c.req.query();
    if (surface === "export") {
      if (method !== "GET" || !supportsBoundDomainQuery(config))
        fail("Operación no anunciada por esta colección.", 405);
      const collection = (await provider.collectionsForTenant(db, tenant)).find(
        (entry) =>
          entry.descriptor.domain === config.domain &&
          entry.descriptor.collection === config.collection,
      );
      if (!collection) fail("Colección no disponible.", 404);
      const { columns, headers } = csvRequest(params, object);
      const rows = await queryableDomainRows(
        db,
        collection,
        config,
        object,
        params,
        provider,
      );
      if (rows.length > 10_000)
        fail("El CSV admite hasta 10.000 registros por archivo.", 405);
      const csv = [
        headers,
        ...rows.map((row) => columns.map((key) => row[key])),
      ]
        .map((line) => line.map(csvCell).join(","))
        .join("\r\n");
      return c.body(`\ufeff${csv}`, 200, {
        "content-disposition": `attachment; filename="${name}.csv"`,
        "content-type": "text/csv; charset=utf-8",
      });
    }
    if (!operation || !(config.capabilities as any)[operation])
      fail("Operación no anunciada por esta colección.", 405);
    let result: {
      data: any;
      total?: number;
      hasNext?: boolean | null;
      page?: number;
      perPage?: number;
    };
    const page = Math.max(1, Math.floor(Number(params.page) || 1)),
      perPage = Math.max(1, Math.floor(Number(params.perPage) || 25));
    if (perPage > 100)
      fail("Las colecciones enlazadas admiten hasta 100 registros por página.");
    if (config.kind === "domain") {
      const queryable = supportsBoundDomainQuery(config);
      if (
        (params.filters && !queryable) ||
        params.stage ||
        params.emptyStage ||
        params.trash === "true" ||
        (params.sort &&
          !["id", "updated_at"].includes(params.sort) &&
          !queryable)
      )
        fail(
          "Esta colección de dominio no anuncia filtros ni orden personalizado.",
        );
      const collection = (await provider.collectionsForTenant(db, tenant)).find(
        (entry) =>
          entry.descriptor.domain === config.domain &&
          entry.descriptor.collection === config.collection,
      );
      if (!collection) fail("Colección no disponible.", 404);
      if (
        operation === "create" ||
        operation === "update" ||
        operation === "delete"
      ) {
        const existing = id ? await collection.find(db, id) : undefined;
        if (id && !existing) fail("Registro no encontrado.", 404);
        const input =
          operation === "delete"
            ? {}
            : await c.req.json<Record<string, unknown>>();
        const previous: Record<string, unknown> = existing
          ? flatten(existing, config, provider)
          : {};
        for (const [key, field] of Object.entries(object.config.fields)) {
          if (
            field.config?.collectionOptions &&
            Object.prototype.hasOwnProperty.call(input, key) &&
            String(input[key] ?? "") !== String(previous[key] ?? "")
          )
            await assertCollectionOption(
              db,
              field.config.collectionOptions,
              input[key],
              provider,
            );
        }
        const doc = await provider.executeDomainWrite(
          db,
          tenant,
          config,
          operation,
          input,
          existing ?? undefined,
          id,
        );
        await audit(db, tenant, `record.${operation}`, name, id ?? doc.id, {
          source: config.resource,
        }).run();
        return c.json(
          {
            data:
              operation === "delete"
                ? { id, deleted: true }
                : flatten(doc, config, provider),
          },
          operation === "create" ? 201 : 200,
        );
      }
      if (operation === "list") {
        if (queryable) {
          const rows = await queryableDomainRows(
            db,
            collection,
            config,
            object,
            params,
            provider,
          );
          const start = (page - 1) * perPage;
          result = {
            data: rows.slice(start, start + perPage),
            total: rows.length,
            page,
            perPage,
            hasNext: start + perPage < rows.length,
          };
        } else {
          const query = {
            limit: Math.min(100, perPage + 1),
            offset: (page - 1) * perPage,
            ...(params.q ? { q: params.q } : {}),
          };
          if (params.q && !collection.listQuerySchema?.shape.q)
            fail("Esta colección no anuncia búsqueda de texto.");
          const response = await collection.list(db, query);
          const probe =
            perPage === 100 &&
            response.page.total === undefined &&
            response.data.length === 100
              ? await collection.list(db, {
                  ...query,
                  limit: 1,
                  offset: query.offset + perPage,
                })
              : undefined;
          result = {
            data: response.data
              .slice(0, perPage)
              .map((doc) => flatten(doc, config, provider)),
            ...(response.page.total !== undefined
              ? { total: response.page.total }
              : {}),
            page,
            perPage,
            hasNext:
              response.page.total !== undefined
                ? page * perPage < response.page.total
                : probe
                  ? probe.data.length > 0
                  : response.data.length > perPage,
          };
        }
      } else {
        const doc = await collection.find(db, id!);
        if (!doc) fail("Registro no encontrado.", 404);
        result = { data: flatten(doc, config, provider) };
      }
    } else {
      if (isDatabaseKind(config.kind) && databaseBridge) {
        const source = await db
          .prepare(
            "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
          )
          .bind(tenant, config.sourceId, principalId)
          .first<SourceRow>();
        if (!source) fail("Source not available.", 404);
        const body =
          operation === "create" || operation === "update"
            ? await c.req.json<Record<string, unknown>>()
            : undefined;
        const databaseResult = await databases.execute(
          source as DatabaseSourceRow,
          config,
          object.config.fields,
          operation,
          id,
          params,
          body,
        );
        const key =
          config.idColumn ?? (config.kind === "mongodb" ? "_id" : "id");
        const withId = (record: Record<string, unknown>) => ({
          ...record,
          id: String(record[key] ?? record.id ?? ""),
        });
        result = {
          ...databaseResult,
          data: Array.isArray(databaseResult.data)
            ? databaseResult.data.map(withId)
            : databaseResult.data
              ? withId(databaseResult.data)
              : null,
        };
        if (["create", "update", "delete"].includes(operation)) {
          try {
            await audit(
              db,
              tenant,
              `collection.record.${operation}`,
              name,
              id ?? String(result.data?.id ?? ""),
              { sourceId: config.sourceId },
            ).run();
          } catch {
            console.error("Database write committed; local audit unavailable.");
            c.header("X-Savia-Write-Outcome", "committed");
          }
        }
      } else if (config.kind === "postgres") {
        const source = await db
          .prepare(
            "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
          )
          .bind(tenant, config.sourceId, principalId)
          .first<SourceRow>();
        if (!source || source.kind !== "postgres")
          fail("Fuente no disponible.", 404);
        if (params.stage || params.emptyStage || params.trash === "true")
          fail("Esta fuente no anuncia etapas ni papelera.");
        const declared = Object.keys(object.config.fields);
        if (!declared.length) fail("La colección no declara columnas.", 422);
        if (declared.length > 100)
          fail("La colección declara demasiadas columnas.", 422);
        let bridgeFilters: Array<{
          field: string;
          op: "eq";
          value: string | number | boolean | null;
        }> = [];
        if (params.filters) {
          const parsed = filterSchema.parse(JSON.parse(params.filters));
          if (
            parsed.logic !== "and" ||
            parsed.conditions.some(
              (condition) =>
                condition.op !== "eq" ||
                !object.config.fields[condition.field] ||
                (condition.value !== null &&
                  !["string", "number", "boolean"].includes(
                    typeof condition.value,
                  )),
            )
          )
            fail(
              "Solo se admiten filtros de igualdad sobre campos explícitos.",
            );
          bridgeFilters = parsed.conditions.map((condition) => ({
            field: condition.field,
            op: "eq" as const,
            value: condition.value as string | number | boolean | null,
          }));
        }
        const sortField =
          params.sort && params.sort !== "updated_at" ? params.sort : undefined;
        if (sortField && sortField !== "id" && !object.config.fields[sortField])
          fail("Campo de orden desconocido.");
        const idColumn = config.idColumn ?? config.primaryKey?.[0] ?? "id";
        const table = sqlIdentifier.parse(config.resource);
        const searchColumns = params.q
          ? declared
              .filter((key) =>
                ["Textbox", "Textarea", "Email", "Phone", "Url"].includes(
                  object.config.fields[key]?.type,
                ),
              )
              .slice(0, 20)
          : [];
        const bridgeResult = await requireSqlBridge().query({
          connection: await postgresConnection(source),
          table,
          operation: operation as "list" | "read",
          ...(operation === "read" ? { id: id!, idColumn } : {}),
          page,
          perPage,
          sort: sortField === "id" || !sortField ? idColumn : sortField,
          order: params.order === "ASC" ? "ASC" : "DESC",
          filters: bridgeFilters,
          searchColumns,
          ...(params.q ? { search: params.q.slice(0, 200) } : {}),
          columns: declared,
        });
        const withId = (row: Record<string, unknown>) => ({
          ...row,
          id: String(row[idColumn] ?? row.id ?? ""),
        });
        result = {
          ...bridgeResult,
          data: Array.isArray(bridgeResult.data)
            ? bridgeResult.data.map(withId)
            : bridgeResult.data
              ? withId(bridgeResult.data as Record<string, unknown>)
              : null,
        };
      } else {
        const source = await db
          .prepare(
            "SELECT * FROM crm_collection_sources WHERE tenant_id=? AND id=? AND owner_principal_id=?",
          )
          .bind(tenant, config.sourceId, principalId)
          .first<SourceRow>();
        if (!source) fail("Fuente no disponible.", 404);
        const connection = JSON.parse(source.config);
        const token = source.encrypted_secret
          ? await decryptSecret(
              source.encrypted_secret,
              integrationKey,
              context(JSON.stringify([tenant, principalId]), source.id),
            )
          : undefined;
        if (
          (params.q && !config.operations?.list?.searchParameter) ||
          params.stage ||
          params.emptyStage ||
          params.trash === "true"
        )
          fail("Esta fuente no anuncia búsqueda libre ni papelera.");
        let filters: any[] | undefined;
        if (params.filters) {
          const parsed = filterSchema.parse(JSON.parse(params.filters));
          if (
            parsed.logic !== "and" ||
            parsed.conditions.some(
              (condition) =>
                condition.op !== "eq" || !object.config.fields[condition.field],
            )
          )
            fail(
              "Solo se admiten filtros de igualdad sobre campos explícitos.",
            );
          filters = parsed.conditions;
        }
        const sort =
          params.sort && params.sort !== "updated_at"
            ? `${params.order === "DESC" ? "-" : ""}${params.sort}`
            : undefined;
        if (sort && !object.config.fields[params.sort] && params.sort !== "id")
          fail("Campo de orden desconocido.");
        let data: Record<string, unknown> | undefined;
        if (operation === "create" || operation === "update") {
          const body = await c.req.json<Record<string, unknown>>();
          for (const key of Object.keys(body))
            if (
              key !== "_version" &&
              (!object.config.fields[key] || object.config.fields[key].readOnly)
            )
              fail(`Campo no editable o no declarado: ${key}.`);
          delete body._version;
          const relationshipValues: Record<string, unknown> = {};
          for (const [key, relationship] of Object.entries(
            config.relationships ?? {},
          )) {
            if (!(key in body)) {
              if (operation === "create" && object.config.fields[key].required)
                fail(`${object.config.fields[key].label}: obligatorio`);
              continue;
            }
            let value = body[key];
            if (relationship.multiple && typeof value === "string") {
              try {
                value = JSON.parse(value);
              } catch {
                fail(`${key}: usa una lista JSON de identificadores.`);
              }
            }
            const parsed = relationship.multiple
              ? z.array(z.string().min(1).max(300)).max(500).safeParse(value)
              : z.string().min(1).max(300).nullable().safeParse(value);
            if (!parsed.success)
              fail(`${key}: identificadores de relación inválidos.`);
            if (
              object.config.fields[key].required &&
              (parsed.data === null ||
                (Array.isArray(parsed.data) && !parsed.data.length))
            )
              fail(`${object.config.fields[key].label}: obligatorio`);
            relationshipValues[key] = parsed.data;
          }
          const fields = Object.fromEntries(
            Object.entries(object.config.fields).filter(
              ([key]) =>
                !config.relationships?.[key] &&
                (operation === "create" || key in body),
            ),
          );
          const attributeBody = Object.fromEntries(
            Object.entries(body).filter(
              ([key]) => !config.relationships?.[key],
            ),
          );
          const checked = validateRecord(
            {
              ...object,
              config: {
                ...object.config,
                fields,
                fieldOrder: Object.keys(fields),
              },
            },
            attributeBody,
          );
          if (Object.keys(checked.errors).length)
            fail(Object.values(checked.errors).join(". "));
          data = {
            ...checked.data,
            ...Object.fromEntries(
              Object.entries(attributeBody).filter(
                ([, value]) => value === null,
              ),
            ),
            ...relationshipValues,
          };
        }
        const key =
          operation === "create" ? c.req.header("Idempotency-Key") : undefined;
        const fingerprint = JSON.stringify(
          canonical({
            name,
            bindingId: config.bindingId,
            baseUrl: connection.baseUrl,
            kind: config.kind,
            sourceId: config.sourceId,
            resource: config.resource,
            resourceType: config.resourceType,
            relationships: config.relationships,
            operations: config.operations,
            data,
          }),
        );
        if (key) {
          if (key.length > 200) fail("Clave de idempotencia demasiado larga.");
          const prior = await db
            .prepare(
              "SELECT fingerprint,state,response FROM crm_collection_requests WHERE tenant_id=? AND request_key=?",
            )
            .bind(tenant, JSON.stringify([principalId, key]))
            .first<{
              fingerprint: string;
              state: string;
              response: string | null;
            }>();
          if (prior) {
            if (prior.fingerprint !== fingerprint)
              fail("La clave ya corresponde a otra solicitud.", 409);
            if (prior.state !== "success")
              fail(
                "La solicitud remota anterior sigue pendiente o su resultado es incierto. Revisa el origen antes de reintentar.",
                409,
              );
            return c.json(JSON.parse(prior.response!), 201);
          }
          await db
            .prepare(
              "INSERT INTO crm_collection_requests(tenant_id,request_key,fingerprint,state) VALUES (?,?,?,'pending')",
            )
            .bind(tenant, JSON.stringify([principalId, key]), fingerprint)
            .run();
        }
        result = await executeJsonApi(
          {
            source: {
              baseUrl: connection.baseUrl,
              token,
              ...connection.options,
            },
            resource: config.resource,
            resourceType: config.resourceType,
            operation,
            id,
            operations: config.operations,
            query: { page, perPage, sort, filters, q: params.q },
            data,
            relationships: config.relationships,
          },
          fetcher,
        );
        const projectRemote = (value: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key]) =>
                  key === "id" ||
                  key === "type" ||
                  key === "_relationships" ||
                  Boolean(object.config.fields[key]),
              )
              .map(([key, value]) => [
                key,
                key === "_relationships" && value && typeof value === "object"
                  ? Object.fromEntries(
                      Object.entries(value).filter(([field]) =>
                        Boolean(config.relationships?.[field]),
                      ),
                    )
                  : value,
              ]),
          );
        result.data = Array.isArray(result.data)
          ? result.data.map(projectRemote)
          : result.data
            ? projectRemote(result.data)
            : null;
        if (key)
          await db
            .prepare(
              "UPDATE crm_collection_requests SET state='success',response=? WHERE tenant_id=? AND request_key=?",
            )
            .bind(
              JSON.stringify({ data: result.data }),
              tenant,
              JSON.stringify([principalId, key]),
            )
            .run();
      }
    }
    if (surface === "record-detail")
      return c.json({
        data: { record: result.data, relations: [], page: 1, perPage },
      });
    if (operation === "delete")
      return c.json({ data: result.data ?? { id, deleted: true } });
    if (operation === "list")
      return c.json({
        ...result,
        pageInfo: {
          hasNextPage:
            result.hasNext ??
            (Array.isArray(result.data) && result.data.length > 0),
          hasPreviousPage: page > 1,
        },
      });
    return c.json(result, operation === "create" ? 201 : 200);
  });
  return app;
}
