import { isDatabaseKind } from "@savia/studio-shared/database-sources";
import {
  emptyCollectionDomainProvider,
  type CollectionDomainProvider,
} from "./collection-domain-provider";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "@hono/zod-openapi";
import {
  operationNames,
  endpointSchema,
  operationMapSchema,
  operationCapabilities,
  inferOperationEndpoints,
  type OperationMap,
  type EndpointCandidate,
} from "@savia/studio-shared/collection-operations";
import { collectionBindingMetadataSchema } from "@savia/studio-shared/metadata";
import { audit, guard, transaction } from "@savia/studio-server/services";
export function defaultOperationMap(
  tenant: string,
  config: any,
  provider: CollectionDomainProvider = emptyCollectionDomainProvider,
): OperationMap {
  const base =
    config.kind === "domain"
      ? `/v1/${config.domain}/${config.collection}`
      : config.resource;
  const write = provider.domainWriteContract(
    tenant,
    config.domain,
    config.collection,
  );
  return Object.fromEntries(
    operationNames.map((action) => {
      const single = ["read", "update", "delete"].includes(action);
      const command =
        config.kind === "domain" &&
        ["create", "update", "delete"].includes(action);
      const enabled = config.capabilities[action] && (!command || write);
      const requestFields = write
        ? Object.fromEntries(
            Object.entries(write.paths).flatMap(([param, path]) => {
              const key = Object.keys(config.fieldPaths ?? {}).find(
                (k) => config.fieldPaths[k].join(".") === path,
              );
              return key ? [[key, param]] : [];
            }),
          )
        : {};
      return [
        action,
        enabled
          ? endpointSchema.parse({
              method: command
                ? "POST"
                : (
                    {
                      list: "GET",
                      read: "GET",
                      create: "POST",
                      update: "PATCH",
                      delete: "DELETE",
                    } as const
                  )[action],
              path: command
                ? `/v1/${config.domain}/commands/${action}-${write!.stem}`
                : base + (single ? "/{id}" : ""),
              format: config.kind === "domain" ? "domain" : "jsonapi",
              requestFields: command ? requestFields : {},
              totalPointer: undefined,
            })
          : null,
      ];
    }),
  ) as OperationMap;
}
export function domainCandidates(
  tenant: string,
  config: any,
  provider: CollectionDomainProvider = emptyCollectionDomainProvider,
): EndpointCandidate[] {
  const all = defaultOperationMap(
    tenant,
    {
      ...config,
      capabilities: {
        list: true,
        read: true,
        create: true,
        update: true,
        delete: true,
      },
    },
    provider,
  );
  return [
    ...provider.registeredCandidates(tenant, config),
    ...operationNames.flatMap((action) =>
      all[action]
        ? [{ endpoint: all[action]!, action, summary: all[action]!.path }]
        : [],
    ),
  ];
}
export function createCollectionOperationsApp(
  db: D1Database,
  tenant: string,
  provider: CollectionDomainProvider = emptyCollectionDomainProvider,
) {
  const app = new Hono();
  async function read(name: string) {
    const row = await db
      .prepare(
        "SELECT b.config,o.config object_config,o.version FROM crm_collection_bindings b JOIN crm_objects o ON o.tenant_id=b.tenant_id AND o.name=b.object_name WHERE b.tenant_id=? AND b.object_name=?",
      )
      .bind(tenant, name)
      .first<{ config: string; object_config: string; version: number }>();
    if (!row)
      throw new HTTPException(404, {
        message: "Colección enlazada no encontrada.",
      });
    return {
      ...row,
      config: JSON.parse(row.config),
      object: JSON.parse(row.object_config),
    };
  }
  app.get("/:name/operations", async (c) => {
    const row = await read(c.req.param("name"));
    return c.json({
      data: {
        version: row.version,
        kind: row.config.kind,
        fields: Object.entries(row.object.fields).map(
          ([key, f]: [string, any]) => ({ key, label: f.label }),
        ),
        operations:
          row.config.operations ??
          defaultOperationMap(tenant, row.config, provider),
        candidates:
          row.config.kind === "domain"
            ? domainCandidates(tenant, row.config, provider)
            : [],
        resource: row.config.resource,
      },
    });
  });
  app.post("/:name/operations/infer", async (c) => {
    const row = await read(c.req.param("name"));
    if (isDatabaseKind(row.config.kind))
      throw new HTTPException(405, {
        message: "Database operations are managed by the adapter.",
      });
    const { document } = z
      .object({ document: z.unknown() })
      .parse(await c.req.json());
    let candidates: EndpointCandidate[];
    try {
      candidates = inferOperationEndpoints(document);
    } catch (e) {
      throw new HTTPException(422, {
        message: e instanceof Error ? e.message : "OpenAPI inválido.",
      });
    }
    if (row.config.kind === "domain") {
      const allowed = domainCandidates(tenant, row.config, provider);
      return c.json({
        data: candidates.flatMap((candidate) => {
          const match = allowed.find(
            (x) =>
              x.endpoint.path === candidate.endpoint.path &&
              x.endpoint.method === candidate.endpoint.method,
          );
          return match ? [{ ...match, summary: candidate.summary }] : [];
        }),
      });
    }
    return c.json({ data: candidates });
  });
  app.put("/:name/operations", async (c) => {
    const name = c.req.param("name"),
      row = await read(name);
    if (isDatabaseKind(row.config.kind))
      throw new HTTPException(405, {
        message: "Las operaciones de bases de datos pertenecen al adaptador.",
      });
    const input = z
      .object({ version: z.number().int(), operations: operationMapSchema })
      .strict()
      .parse(await c.req.json());
    if (input.version !== row.version)
      throw new HTTPException(409, {
        message: "La colección cambió. Recarga antes de guardar.",
      });
    const allowed = domainCandidates(tenant, row.config, provider);
    provider.installCommandFields(
      tenant,
      row.config,
      row.object,
      input.operations,
    );
    for (const action of operationNames) {
      const endpoint = input.operations[action];
      if (!endpoint) continue;
      if (["list", "read"].includes(action) && endpoint.method !== "GET")
        throw new HTTPException(422, {
          message: "Listar y consultar deben usar GET.",
        });
      if (!["list", "read"].includes(action) && endpoint.method === "GET")
        throw new HTTPException(422, {
          message: "Una escritura no puede usar GET.",
        });
      if (action === "delete" && !["DELETE", "POST"].includes(endpoint.method))
        throw new HTTPException(422, {
          message: "Eliminar requiere DELETE o POST.",
        });
      if (
        ["create", "update"].includes(action) &&
        !["POST", "PUT", "PATCH"].includes(endpoint.method)
      )
        throw new HTTPException(422, {
          message: "Crear y editar requieren POST, PUT o PATCH.",
        });
      if (row.config.kind === "domain") {
        if (
          !allowed.some(
            (x) =>
              x.action === action &&
              x.endpoint.path === endpoint.path &&
              x.endpoint.method === endpoint.method,
          ) ||
          endpoint.format !== "domain"
        )
          throw new HTTPException(422, {
            message: "El endpoint no pertenece al contrato de esta colección.",
          });
        const expected = allowed.find((x) => x.action === action)!.endpoint;
        for (const key of [
          "dataPointer",
          "idPointer",
          "idBodyField",
          "totalPointer",
          "pageParameter",
          "sizeParameter",
          "searchParameter",
        ] as const)
          if (endpoint[key] !== expected[key])
            throw new HTTPException(422, {
              message:
                "La respuesta y paginación internas pertenecen al contrato del dominio.",
            });
        const validParams = new Set(
          Object.keys(
            provider.domainWriteContract(
              tenant,
              row.config.domain,
              row.config.collection,
            )?.paths ?? {},
          ),
        );
        const registered = provider
          .registeredCollectionCommands(tenant, row.config)
          .find(
            (c) => endpoint.path === `/v1/${c.domain}/commands/${c.command}`,
          );
        for (const field of registered?.input ?? [])
          validParams.add(field.name);
        if (registered && action === "create")
          for (const field of registered.input)
            if (
              field.required &&
              !Object.values(endpoint.requestFields).includes(field.name)
            )
              throw new HTTPException(422, {
                message: `Falta mapear el parámetro obligatorio ${field.name}.`,
              });
        if (
          Object.values(endpoint.requestFields).some(
            (p) => !validParams.has(p),
          ) ||
          Object.keys(endpoint.responseFields).length
        )
          throw new HTTPException(422, {
            message: "Mapeo incompatible con el contrato del dominio.",
          });
      } else if (endpoint.format === "domain")
        throw new HTTPException(422, {
          message: "Una fuente remota no puede ejecutar comandos internos.",
        });
      if (row.config.kind !== "domain") {
        const hasId = endpoint.path.includes("{id}");
        if (["list", "create"].includes(action) && hasId)
          throw new HTTPException(422, {
            message: "Esta acción no dispone de un ID de registro.",
          });
        if (action === "read" && !hasId)
          throw new HTTPException(422, {
            message: "Consultar requiere {id} en la ruta.",
          });
        if (
          ["update", "delete"].includes(action) &&
          !hasId &&
          !(
            ["POST", "PUT", "PATCH"].includes(endpoint.method) &&
            endpoint.format === "json"
          )
        )
          throw new HTTPException(422, {
            message:
              "Configura {id} en la ruta o un comando JSON con identificador en el cuerpo.",
          });
      }
      if (
        new Set(Object.values(endpoint.requestFields)).size !==
        Object.keys(endpoint.requestFields).length
      )
        throw new HTTPException(422, {
          message: "Dos campos no pueden escribir en el mismo parámetro.",
        });
      for (const key of [
        ...Object.keys(endpoint.requestFields),
        ...Object.keys(endpoint.responseFields),
      ])
        if (!row.object.fields[key])
          throw new HTTPException(422, {
            message: `Campo desconocido: ${key}`,
          });
    }
    const capabilities = {
      ...row.config.capabilities,
      ...operationCapabilities(input.operations),
      ...(row.config.kind === "jsonapi"
        ? { search: Boolean(input.operations.list?.searchParameter) }
        : {}),
    };
    const config = {
      ...row.config,
      operations: input.operations,
      capabilities,
    };
    row.object.studio = {
      ...row.object.studio,
      collection: collectionBindingMetadataSchema.parse(config),
      capabilities,
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
        .bind(JSON.stringify(config), tenant, name),
      db
        .prepare(
          "UPDATE crm_objects SET config=?,version=version+1 WHERE tenant_id=? AND name=?",
        )
        .bind(JSON.stringify(row.object), tenant, name),
      audit(db, tenant, "collection.operations.updated", name, null, {
        operations: input.operations,
      }),
      g.end,
    ]);
    return c.json({
      data: {
        version: row.version + 1,
        operations: input.operations,
        capabilities,
      },
    });
  });
  return app;
}
