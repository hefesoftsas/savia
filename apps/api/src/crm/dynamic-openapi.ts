import type { CrmObject } from "@savia/crm-shared/metadata";
import { disabledSolutionObjects } from "@savia/crm-server/solution-state";
import { parseObject } from "@savia/crm-server/services";

type Schema = Record<string, unknown>;
type Paths = Record<string, Record<string, unknown>>;
const json = (schema: Schema) => ({ "application/json": { schema } });
const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
const envelope = (schema: Schema): Schema => ({
  type: "object",
  required: ["data"],
  properties: { data: schema },
});
const parameter = (
  name: string,
  location: "query" | "path" | "header",
  schema: Schema,
  required = false,
  description?: string,
) => ({
  name,
  in: location,
  required,
  schema,
  ...(description ? { description } : {}),
});
const recordId = parameter(
  "id",
  "path",
  { type: "string", format: "uuid" },
  true,
);
const idempotency = parameter(
  "Idempotency-Key",
  "header",
  { type: "string", minLength: 1, maxLength: 200 },
  false,
  "Reutiliza la misma clave y cuerpo al recuperar un envío. Una clave con otros datos devuelve 409.",
);
const failures = Object.fromEntries(
  [
    [400, "Solicitud inválida"],
    [401, "Sesión requerida"],
    [403, "Sin acceso a esta agencia"],
    [404, "Objeto o registro inexistente"],
    [409, "Conflicto de versión, unicidad o idempotencia"],
    [413, "Solicitud demasiado grande"],
    [422, "Validación del objeto"],
    [428, "Versión requerida"],
    [500, "Error interno"],
    [503, "Servicio no disponible"],
  ].map(([code, description]) => [
    code,
    { description, content: json(ref("CrmError")) },
  ]),
);
function operation(
  id: string,
  tag: string,
  summary: string,
  response: Schema,
  options: {
    parameters?: unknown[];
    body?: Schema;
    status?: number;
    description?: string;
  } = {},
) {
  return {
    operationId: id,
    tags: [tag],
    summary,
    ...(options.description ? { description: options.description } : {}),
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.body
      ? { requestBody: { required: true, content: json(options.body) } }
      : {}),
    responses: {
      ...failures,
      [options.status ?? 200]: {
        description: "Operación completada",
        content: json(response),
      },
    },
  };
}

function fieldSchema(field: CrmObject["config"]["fields"][string]): Schema {
  const c = field.config ?? {};
  let value: Schema = c.multiple
    ? {
        type: "array",
        items: { type: "string" },
        maxItems: 500,
        uniqueItems: true,
      }
    : {
        type:
          field.type === "Number"
            ? c.integer
              ? "integer"
              : "number"
            : field.type === "Toggle"
              ? "boolean"
              : "string",
      };
  if (field.type === "Number") {
    if (typeof c.minimum === "number") value.minimum = c.minimum;
    if (typeof c.maximum === "number") value.maximum = c.maximum;
  }
  if (value.type === "string") {
    value.maxLength = typeof c.maxLength === "number" ? c.maxLength : 10000;
    if (typeof c.minLength === "number") value.minLength = c.minLength;
    if (field.required && !field.hidden && !c.visibleWhen)
      value.minLength = Math.max(
        1,
        typeof c.minLength === "number" ? c.minLength : 0,
      );
    if (typeof c.pattern === "string") value.pattern = c.pattern;
    if (c.format === "email") value.format = "email";
    if (c.format === "url") value.format = "uri";
    if (field.type === "DateControl") value.format = "date";
    if (field.type === "Dropdown" && !c.relation)
      value.enum = (field.options ?? []).map((o) => o.value);
  }
  // Empty optional values normalize to null; conditional requirements are evaluated by the shared engine.
  if (!field.required || field.hidden || c.visibleWhen)
    value = {
      anyOf: [value, { type: "null" }, { const: "" }],
    };
  return {
    ...value,
    title: field.label,
    ...(field.description ? { description: field.description } : {}),
    ...(field.defaultValue !== undefined
      ? { default: field.defaultValue }
      : {}),
    ...(c.formula ? { readOnly: true, "x-crm-formula": c.formula } : {}),
    ...(c.relation ? { "x-crm-relation": c.relation } : {}),
    ...(c.unique ? { "x-crm-unique": true } : {}),
    ...(c.visibleWhen ? { "x-crm-visible-when": c.visibleWhen } : {}),
    ...(c.requiredWhen ? { "x-crm-required-when": c.requiredWhen } : {}),
    ...(c.jsonSchema
      ? {
          description: "Texto JSON validado por el esquema indicado.",
          "x-crm-json-schema": c.jsonSchema,
        }
      : {}),
  };
}

export async function dynamicOpenApi(
  db: D1Database,
  agencyId: number | { tenant: string; apiBasePath: string },
) {
  const tenant =
    typeof agencyId === "number" ? `agency:${agencyId}` : agencyId.tenant;
  const apiBasePath =
    typeof agencyId === "number"
      ? `/v1/dynamic-crm/${agencyId}`
      : agencyId.apiBasePath;
  const { results } = await db
    .prepare("SELECT * FROM crm_objects WHERE tenant_id=? ORDER BY name")
    .bind(tenant)
    .all();
  const disabled = await disabledSolutionObjects(db, tenant);
  const objects = results
    .map(parseObject)
    .filter((object) => !disabled.has(object.name));
  const paths: Paths =
    typeof agencyId === "number"
      ? {}
      : {
          "/collection-relations": {
            get: operation(
              "collection_relations_list",
              "Relaciones",
              "Listar relaciones entre colecciones",
              envelope({ type: "array", items: { type: "object" } }),
            ),
            post: operation(
              "collection_relations_create",
              "Relaciones",
              "Definir una relación local",
              envelope({ type: "object" }),
              {
                status: 201,
                body: {
                  type: "object",
                  required: [
                    "sourceObject",
                    "targetObject",
                    "sourceLabel",
                    "targetLabel",
                    "cardinality",
                  ],
                  properties: {
                    storage: { type: "string", enum: ["local", "fields"] },
                    sourceField: { type: "string" },
                    targetField: { type: "string" },
                    sourceDisplayField: { type: "string" },
                    targetDisplayField: { type: "string" },
                    sourceObject: { type: "string" },
                    targetObject: { type: "string" },
                    sourceLabel: { type: "string" },
                    targetLabel: { type: "string" },
                    cardinality: {
                      type: "string",
                      enum: ["one-to-one", "one-to-many", "many-to-many"],
                    },
                  },
                },
                description:
                  "Guarda la definición en Savia. No modifica esquemas ni vínculos del proveedor externo.",
              },
            ),
          },
          "/collection-relations/{relationId}": {
            put: operation(
              "collection_relations_update",
              "Relaciones",
              "Editar campos y presentación de una relación",
              envelope({ type: "object" }),
              {
                parameters: [
                  parameter("relationId", "path", { type: "string" }, true),
                ],
                body: {
                  type: "object",
                  required: [
                    "version",
                    "sourceObject",
                    "targetObject",
                    "sourceLabel",
                    "targetLabel",
                    "cardinality",
                  ],
                  properties: {
                    version: { type: "integer", minimum: 1 },
                    storage: {
                      type: "string",
                      enum: ["local", "fields", "native"],
                    },
                    sourceField: { type: "string" },
                    targetField: { type: "string" },
                    sourceDisplayField: { type: "string" },
                    targetDisplayField: { type: "string" },
                    sourceObject: { type: "string" },
                    targetObject: { type: "string" },
                    sourceLabel: { type: "string" },
                    targetLabel: { type: "string" },
                    cardinality: {
                      type: "string",
                      enum: ["one-to-one", "one-to-many", "many-to-many"],
                    },
                  },
                },
                description:
                  "Requiere la versión vigente. Las relaciones nativas permiten presentación; su referencia pertenece al origen. Las relaciones por campos solo se guardan para fuentes y campos compatibles.",
              },
            ),
            delete: operation(
              "collection_relations_delete",
              "Relaciones",
              "Eliminar definición y vínculos locales",
              envelope({ type: "object" }),
              {
                parameters: [
                  parameter("relationId", "path", { type: "string" }, true),
                ],
                description:
                  "Elimina solo la relación local y sus vínculos. Conserva los registros. No elimina relaciones nativas del origen.",
              },
            ),
          },
          "/record-links/{object}/{id}": {
            get: operation(
              "record_links_list",
              "Relaciones",
              "Consultar registros relacionados",
              envelope({ type: "array", items: { type: "object" } }),
              {
                parameters: [
                  parameter("object", "path", { type: "string" }, true),
                  parameter("id", "path", { type: "string" }, true),
                  parameter("page", "query", { type: "integer", minimum: 1 }),
                  parameter("perPage", "query", {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                  }),
                ],
              },
            ),
          },
          "/record-links/{object}/{id}/{relationId}": Object.fromEntries(
            ["post", "delete"].map((method) => [
              method,
              operation(
                `record_links_${method === "post" ? "create" : "delete"}`,
                "Relaciones",
                method === "post"
                  ? "Vincular registros"
                  : "Desvincular registros",
                envelope({ type: "object" }),
                {
                  parameters: [
                    parameter("object", "path", { type: "string" }, true),
                    parameter("id", "path", { type: "string" }, true),
                    parameter("relationId", "path", { type: "string" }, true),
                  ],
                  body: {
                    type: "object",
                    required: ["targetId"],
                    properties: { targetId: { type: "string" } },
                  },
                  description:
                    "Solo relaciones locales; valida existencia y cardinalidad. No elimina ni cambia datos del registro.",
                },
              ),
            ]),
          ),
          "/sources": {
            get: operation(
              "collection_sources_list",
              "Fuentes y colecciones",
              "Listar fuentes del dominio",
              envelope({ type: "array", items: { type: "object" } }),
            ),
            post: operation(
              "collection_sources_create",
              "Fuentes y colecciones",
              "Configurar una fuente externa",
              envelope({ type: "object" }),
              {
                status: 201,
                body: {
                  type: "object",
                  required: ["id", "label", "kind"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    kind: { enum: ["jsonapi", "postgres"] },
                    baseUrl: { type: "string", format: "uri" },
                    token: { type: "string", writeOnly: true },
                    host: { type: "string" },
                    port: { type: "integer" },
                    database: { type: "string" },
                    username: { type: "string" },
                    password: { type: "string", writeOnly: true },
                    schema: { type: "string" },
                    ssl: { type: "boolean" },
                    options: { type: "object" },
                  },
                },
              },
            ),
          },
          "/collection-catalog": {
            get: operation(
              "collection_catalog",
              "Fuentes y colecciones",
              "Consultar colecciones de negocio disponibles",
              envelope({ type: "array", items: { type: "object" } }),
            ),
          },
          "/collection-bindings/{name}/operations": {
            get: operation(
              "collection_operations_get",
              "Fuentes y colecciones",
              "Consultar endpoints y mapeos de una colección",
              envelope({ type: "object" }),
              {
                parameters: [
                  parameter("name", "path", { type: "string" }, true),
                ],
              },
            ),
            put: operation(
              "collection_operations_save",
              "Fuentes y colecciones",
              "Guardar operaciones y derivar capacidades",
              envelope({ type: "object" }),
              {
                parameters: [
                  parameter("name", "path", { type: "string" }, true),
                ],
                body: {
                  type: "object",
                  required: ["version", "operations"],
                  properties: {
                    version: { type: "integer" },
                    operations: {
                      type: "object",
                      description:
                        "list, read, create, update y delete; cada acción es null o un endpoint con method, path, format y mapeos.",
                    },
                  },
                },
              },
            ),
          },
          "/collection-bindings/{name}/operations/infer": {
            post: operation(
              "collection_operations_infer",
              "Fuentes y colecciones",
              "Detectar candidatos desde OpenAPI sin ejecutarlos",
              envelope({ type: "array", items: { type: "object" } }),
              {
                parameters: [
                  parameter("name", "path", { type: "string" }, true),
                ],
                body: {
                  type: "object",
                  required: ["document"],
                  properties: {
                    document: {
                      description: "Documento OpenAPI 3 JSON o YAML",
                    },
                  },
                },
              },
            ),
          },
          "/collection-bindings": {
            get: operation(
              "collection_bindings_list",
              "Fuentes y colecciones",
              "Listar colecciones conectadas",
              envelope({ type: "array", items: { type: "object" } }),
            ),
            post: operation(
              "collection_bindings_create",
              "Fuentes y colecciones",
              "Conectar una colección a una pantalla",
              envelope({ type: "object" }),
              {
                status: 201,
                body: {
                  type: "object",
                  required: ["name", "label"],
                  properties: {
                    name: { type: "string" },
                    label: { type: "string" },
                    domain: { type: "string" },
                    collection: { type: "string" },
                    sourceId: { type: "string" },
                    resource: { type: "string" },
                    fields: { type: "object" },
                    capabilities: { type: "object" },
                  },
                },
                description:
                  "Selecciona domain y collection para un dominio existente, o sourceId, resource y fields para JSON:API o Postgres. No copia los registros externos.",
              },
            ),
          },
        };
  const schemas: Record<string, Schema> = {
    CrmError: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message"],
          properties: { code: { type: "string" }, message: { type: "string" } },
        },
      },
    },
    CrmHubSpotStatus: {
      type: "object",
      required: ["status"],
      properties: {
        status: {
          type: "string",
          enum: [
            "not_synced",
            "synced",
            "syncing",
            "uncertain",
            "connection_required",
          ],
        },
        externalObjectId: { type: "string" },
        url: { type: "string", format: "uri" },
        lastSyncedAt: { type: "string" },
        operation: { type: "string", enum: ["created", "updated"] },
      },
    },
  };
  for (const object of objects) {
    const name = object.name;
    const binding = object.config.studio?.collection;
    const capabilities =
      object.config.studio?.capabilities ?? binding?.capabilities;
    const properties = Object.fromEntries(
      Object.entries(object.config.fields).map(([key, field]) => [
        key,
        fieldSchema(field),
      ]),
    );
    const required = Object.entries(object.config.fields)
      .filter(
        ([, f]) =>
          f.required &&
          !f.hidden &&
          !f.config?.visibleWhen &&
          !f.config?.formula &&
          f.defaultValue === undefined,
      )
      .map(([key]) => key);
    const managedAgency = tenant === "domain:platform" && name === "agencias";
    const managedCustomer = tenant === "domain:platform" && name === "clientes";
    const idSchema: Schema = binding
      ? { type: "string", minLength: 1, maxLength: 256 }
      : managedAgency || managedCustomer
        ? { type: "string", pattern: "^[1-9][0-9]*$" }
        : { type: "string", format: "uuid" };
    const objectRecordId =
      binding || managedAgency || managedCustomer
        ? parameter("id", "path", idSchema, true)
        : recordId;
    const base: Schema = {
      type: "object",
      additionalProperties: false,
      properties,
      "x-crm-schema-version": object.version ?? 1,
      ...(binding ? { "x-savia-collection": binding } : {}),
    };
    schemas[`${name}_Create`] = {
      ...base,
      ...(required.length ? { required } : {}),
    };
    schemas[`${name}_Update`] = {
      ...base,
      properties: { ...properties, _version: { type: "integer", minimum: 1 } },
      required: binding ? [] : ["_version"],
    };
    schemas[`${name}_Record`] = {
      ...base,
      properties: {
        ...properties,
        id: idSchema,
        ...(binding
          ? { type: { type: "string" }, _relationships: { type: "object" } }
          : {}),
        _version: { type: "integer", minimum: 1 },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        deleted_at: { type: ["string", "null"] },
      },
      required: binding
        ? ["id"]
        : ["id", "_version", "created_at", "updated_at"],
    };
    const record = envelope(ref(`${name}_Record`));
    paths[`/published/${name}`] = {
      get: operation(
        `${name}_list`,
        object.label,
        `Listar ${object.label}`,
        {
          type: "object",
          required: binding ? ["data"] : ["data", "total", "page", "perPage"],
          properties: {
            data: { type: "array", items: ref(`${name}_Record`) },
            total: { type: "integer" },
            page: { type: "integer" },
            perPage: { type: "integer" },
          },
        },
        {
          parameters: [
            parameter("page", "query", {
              type: "integer",
              minimum: 1,
              default: 1,
            }),
            parameter("perPage", "query", {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 25,
            }),
            parameter("q", "query", { type: "string", maxLength: 200 }),
            parameter("sort", "query", {
              type: "string",
              enum: [
                ...new Set([
                  "id",
                  "created_at",
                  "updated_at",
                  ...Object.keys(properties),
                ]),
              ],
              default: "updated_at",
            }),
            parameter("order", "query", {
              type: "string",
              enum: ["ASC", "DESC"],
              default: "DESC",
            }),
            parameter(
              "filters",
              "query",
              { type: "string" },
              false,
              'JSON: {"logic":"and","conditions":[{"field":"name","op":"contains","value":"Ana"}]}. Operadores: eq, ne, gt, gte, lt, lte, contains, startsWith, empty, in.',
            ),
          ],
        },
      ),
      post: operation(
        `${name}_create`,
        object.label,
        `Crear ${object.label}`,
        record,
        { body: ref(`${name}_Create`), parameters: [idempotency], status: 201 },
      ),
    };
    paths[`/published/${name}/{id}`] = {
      get: operation(
        `${name}_read`,
        object.label,
        "Consultar registro",
        record,
        { parameters: [objectRecordId] },
      ),
      patch: operation(
        `${name}_update`,
        object.label,
        "Actualizar registro",
        record,
        {
          parameters: [objectRecordId],
          body: ref(`${name}_Update`),
          description: binding
            ? "Actualización mediante el adaptador de la colección. Las reglas y garantías de concurrencia dependen del origen."
            : "Actualización parcial. _version debe coincidir con la versión leída; los campos omitidos conservan su valor.",
        },
      ),
      delete: operation(
        `${name}_delete`,
        object.label,
        "Eliminar registro",
        envelope({ type: "object" }),
        {
          parameters: [
            objectRecordId,
            parameter(
              "version",
              "query",
              { type: "integer", minimum: 1 },
              !binding,
            ),
          ],
          description: binding
            ? "Eliminación en el origen mediante su adaptador; no implica papelera local."
            : managedCustomer
              ? "Eliminación permanente del perfil, sujeta a las restricciones de relaciones. No admite restauración."
              : "Borrado lógico sujeto a las restricciones de relaciones.",
        },
      ),
    };
    if (managedCustomer) {
      paths["/business/managed-clientes/sync"] = {
        get: operation(
          "clientes_batch_sync_state",
          object.label,
          "Consultar conexiones CRM de la selección",
          envelope({
            type: "object",
            properties: {
              activeCustomerIds: { type: "array", items: { type: "integer" } },
            },
          }),
          {
            parameters: [
              parameter(
                "customerIds",
                "query",
                { type: "string" },
                true,
                "Entre 1 y 100 IDs separados por comas.",
              ),
            ],
          },
        ),
        post: operation(
          "clientes_batch_sync",
          object.label,
          "Sincronizar selección con HubSpot",
          envelope({
            type: "object",
            properties: {
              items: { type: "array", items: { type: "object" } },
              summary: { type: "object" },
            },
          }),
          {
            body: {
              type: "object",
              required: ["customerIds"],
              additionalProperties: false,
              properties: {
                customerIds: {
                  type: "array",
                  minItems: 1,
                  maxItems: 100,
                  items: { type: "integer", minimum: 1 },
                },
              },
            },
            description:
              "Sincronización explícita con la conexión de cada agencia; devuelve el resultado por cliente.",
          },
        ),
      };
      paths[`/business/managed-clientes/{id}/sync`] = {
        get: operation(
          "clientes_sync_state",
          object.label,
          "Consultar conexión CRM y enlaces",
          envelope({
            type: "object",
            properties: {
              active: { type: "boolean" },
              links: { type: "array", items: { type: "object" } },
            },
          }),
          { parameters: [objectRecordId] },
        ),
        post: operation(
          "clientes_sync",
          object.label,
          "Sincronizar cliente con HubSpot",
          envelope({
            type: "object",
            properties: {
              items: { type: "array", items: { type: "object" } },
              summary: { type: "object" },
            },
          }),
          {
            parameters: [objectRecordId],
            description:
              "Sincronización explícita de persona natural o jurídica con la conexión activa de su agencia.",
          },
        ),
      };
    }
    if (managedAgency) delete paths[`/published/${name}/{id}`].delete;
    if (binding) {
      const listing = paths[`/published/${name}`].get as {
        parameters?: Array<{ name: string; schema?: Record<string, unknown> }>;
      };
      listing.parameters = listing.parameters
        ?.filter((parameter) => {
          if (parameter.name === "q") return capabilities?.search === true;
          if (["sort", "order"].includes(parameter.name))
            return capabilities?.sort === true;
          if (parameter.name === "filters")
            return capabilities?.filter === true;
          return true;
        })
        .map((parameter) =>
          parameter.name === "perPage"
            ? { ...parameter, schema: { ...parameter.schema, maximum: 100 } }
            : parameter,
        );
      if (capabilities?.filter) {
        const filter = listing.parameters?.find(
          (p) => p.name === "filters",
        ) as any;
        if (filter)
          filter.description =
            'JSON: {"logic":"and","conditions":[{"field":"name","op":"eq","value":"Ana"}]}. Solo igualdad sobre campos declarados.';
      }
    }
    if (capabilities) {
      if (!capabilities.list) delete paths[`/published/${name}`].get;
      if (!capabilities.create) delete paths[`/published/${name}`].post;
      if (!capabilities.read) delete paths[`/published/${name}/{id}`].get;
      if (!capabilities.update) delete paths[`/published/${name}/{id}`].patch;
      if (!capabilities.delete) delete paths[`/published/${name}/{id}`].delete;
    }

    if (
      typeof agencyId === "number" &&
      object.config.studio?.business === "customer"
    ) {
      paths[`/business/${name}/{id}/hubspot`] = {
        get: operation(
          `${name}_hubspot_status`,
          object.label,
          "Consultar vínculo con HubSpot",
          envelope(ref("CrmHubSpotStatus")),
          { parameters: [objectRecordId] },
        ),
        post: operation(
          `${name}_hubspot_sync`,
          object.label,
          "Sincronizar con HubSpot",
          envelope(ref("CrmHubSpotStatus")),
          {
            parameters: [objectRecordId],
            description:
              "Envía el registro a la conexión HubSpot de esta agencia. Acción externa explícita; no reintentar automáticamente un resultado incierto.",
          },
        ),
      };
      if (
        objects.some(
          (o) =>
            o.name === "cotizaciones" &&
            o.config.studio?.business === "quotation",
        )
      )
        paths[`/business/${name}/{id}/quotations`] = {
          post: operation(
            `${name}_quotation_create`,
            object.label,
            "Crear borrador de cotización relacionado",
            envelope(ref("cotizaciones_Record")),
            {
              parameters: [recordId, { ...idempotency, required: true }],
              body: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200 },
                  plate: { type: "string", maxLength: 20 },
                },
              },
              status: 201,
              description:
                "Guarda una cotización en estado draft vinculada al cliente; no ejecuta aseguradoras.",
            },
          ),
        };
    }
  }
  return {
    openapi: "3.1.0" as const,
    info: {
      title: "CRM de Savia",
      version: "1.0.0",
      description:
        "Contrato generado con los objetos y versiones actuales de este dominio de datos. Las condiciones, relaciones y unicidad se validan en el servidor. Requiere permiso de administración del dominio.",
    },
    servers: [{ url: `${apiBasePath}/api` }],
    security: [{ bearerAuth: [] }],
    tags: [
      ...objects.map((o) => ({ name: o.label, description: o.description })),
      ...(typeof agencyId === "number"
        ? []
        : [
            {
              name: "Fuentes y colecciones",
              description:
                "Configuración del dominio; credenciales solo en el servidor.",
            },
          ]),
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: { type: "http" as const, scheme: "bearer" },
      },
    },
  };
}
