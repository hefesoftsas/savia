import { dialectFor } from "@savia/db/dialect";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { CollectionGatewayContext } from "./collection-gateway";
import { createCrmRepository } from "./repository";
import { hubspotObjects, hubspotObject } from "./hubspot-workspace-catalog";
import { objectSchema } from "@savia/crm-shared/metadata";
import { canAccessSharedCrm, canManageSharedCrm } from "./hubspot-access";
import { audit, getObject } from "@savia/crm-server/services";
import type { ActiveCrmConnection } from "./contracts";

type Binding = {
  kind: "crm";
  accessScope?: "tenant";
  provider: "hubspot";
  resource: string;
  principalId: string;
  connectionId: string;
  accountId: string;
  propertyTypes?: Record<string, string>;
  capabilities: ReturnType<typeof capabilities>;
};
function fail(
  message: string,
  status: 403 | 404 | 405 | 409 | 422 | 502 | 503 = 422,
): never {
  throw new HTTPException(status, { message });
}
export function capabilities(scopes: string[], resource: string) {
  const scope = ["tasks", "notes", "meetings", "calls"].includes(resource)
    ? "contacts"
    : resource;
  const write =
    scopes.includes(`crm.objects.${scope}.write`) ||
    (scope === "tickets" && scopes.includes("tickets"));
  return {
    list: true,
    read: true,
    create: write,
    update: write,
    delete: write,
    schema: false,
    customFields: false,
    search: true,
    filter: false,
    sort: false,
  };
}
export async function crmWorkspaceBinding(
  db: D1Database,
  tenant: string,
  name: string,
): Promise<Binding | undefined> {
  const row = await db
    .prepare(
      "SELECT config FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
    )
    .bind(tenant, name)
    .first<{ config: string }>();
  const config = row ? JSON.parse(row.config) : undefined;
  return config?.kind === "crm" ? config : undefined;
}
export async function handlesHubspotWorkspace(
  context: CollectionGatewayContext,
  path: string,
) {
  if (/^\/api\/crm-workspace(?:\/install)?$/.test(path)) return true;
  const match =
    /^\/api\/(?:objects|records|record-detail|record-activity|record-notes|record-links|files|import|export|views)\/([^/]+)/.exec(
      path,
    );
  // Presentation/schema editing remains under the bound collection contract guard.
  return Boolean(
    match &&
    !["objects", "views"].includes(path.split("/")[2]) &&
    (await crmWorkspaceBinding(
      context.db,
      context.tenant,
      decodeURIComponent(match[1]),
    )),
  );
}
export function createHubspotWorkspaceApp(context: CollectionGatewayContext) {
  const { db, tenant, actor, crm } = context;
  const app = new Hono();
  app.onError((e, c) =>
    e instanceof HTTPException
      ? c.json({ error: e.message }, e.status)
      : c.json({ error: "No se pudo completar la operación en HubSpot." }, 502),
  );
  app.use("*", async (c, next) => {
    if (!canAccessSharedCrm(actor, tenant))
      fail("No tienes acceso a este tenant.", 403);
    if (c.req.method !== "GET" && !canManageSharedCrm(actor, tenant))
      fail("Esta operación requiere administrar el tenant.", 403);
    await next();
  });
  async function connection(binding?: Binding) {
    if (
      binding &&
      binding.accessScope !== "tenant" &&
      binding.principalId !== actor.principal.id
    )
      fail("Esta colección pertenece a otra conexión de HubSpot.", 403);
    const owner = binding?.principalId ?? actor.principal.id;
    const current = await createCrmRepository(
      db,
    ).findActiveConnectionForPrincipal("hubspot", owner);
    if (
      !current ||
      current.status !== "connected" ||
      !current.externalAccountId
    )
      fail("La conexión de HubSpot del tenant debe reconectarse.", 409);
    if (
      binding &&
      (binding.connectionId !== current.id ||
        binding.accountId !== current.externalAccountId ||
        !hubspotObject(binding.resource))
    )
      fail(
        "La conexión de esta colección ha cambiado. Un administrador debe revisarla.",
        403,
      );
    if (!crm) fail("HubSpot no está disponible.", 503);
    return current;
  }
  async function remote(
    conn: ActiveCrmConnection,
    path: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT" = "GET",
    body?: unknown,
  ) {
    const response = await crm!.nango.proxy({
      connection: conn,
      path,
      method: method as any,
      ...(body === undefined ? {} : { body }),
    });
    await audit(
      db,
      tenant,
      method === "GET" ||
        (method === "POST" &&
          /\/(?:search|batch\/read)$/.test(path.split("?")[0]))
        ? "hubspot.read"
        : "hubspot.write",
      "hubspot",
      null,
      {
        principalId: actor.principal.id,
        connectionId: conn.id,
        method,
        // Keep search terms, payloads, credentials, and provider records out of audit logs.
        resource: path.split("?")[0].split("/").slice(0, 5).join("/"),
        status: response.status,
      },
    ).run();
    if (!response.ok)
      fail(
        response.status === 403
          ? "HubSpot no autoriza esta operación. Revisa los permisos de la conexión."
          : response.status === 404
            ? "Registro no encontrado en HubSpot."
            : "HubSpot no pudo completar la solicitud.",
        response.status === 403
          ? 403
          : response.status === 404
            ? 404
            : response.status === 400
              ? 422
              : 502,
      );
    return response.status === 204 ? {} : ((await response.json()) as any);
  }
  async function discover(conn: ActiveCrmConnection) {
    return Promise.all(
      hubspotObjects.map(async (item) => {
        const base = {
          resource: item.resource,
          name: `hubspot_${item.resource}`,
          label: item.label,
          capabilities: capabilities(conn.scopes, item.resource),
        };
        try {
          await remote(conn, `/crm/v3/objects/${item.resource}?limit=1`);
          return { ...base, available: true };
        } catch (e) {
          if (e instanceof HTTPException && [403, 404].includes(e.status))
            return {
              ...base,
              available: false,
              reason: "La conexión no tiene acceso a este objeto.",
            };
          throw e;
        }
      }),
    );
  }
  app.get("/api/crm-workspace", async (c) => {
    const conn = await createCrmRepository(db).findActiveConnectionForPrincipal(
      "hubspot",
      actor.principal.id,
    );
    if (!conn || conn.status !== "connected")
      return c.json({
        data: { provider: "hubspot", connected: false, objects: [] },
      });
    await connection();
    return c.json({
      data: {
        provider: "hubspot",
        connected: true,
        accountLabel: conn.externalAccountLabel,
        objects: await discover(conn),
      },
    });
  });
  app.post("/api/crm-workspace/install", async (c) => {
    const conn = await connection(),
      discovered = await discover(conn),
      installed = [];
    const statements: D1PreparedStatement[] = [];
    for (const item of discovered.filter((x) => x.available)) {
      const existing = await db
        .prepare("SELECT name FROM crm_objects WHERE tenant_id=? AND name=?")
        .bind(tenant, item.name)
        .first();
      if (existing) {
        const binding = await crmWorkspaceBinding(db, tenant, item.name);
        if (!binding)
          fail("El nombre de una colección CRM ya está en uso.", 409);
        if (
          binding.principalId !== actor.principal.id ||
          binding.accountId !== conn.externalAccountId
        )
          fail("Esta colección pertenece a otra cuenta de HubSpot.", 403);
      }
      const catalog = hubspotObject(item.resource)!;
      const properties = await remote(
        conn,
        `/crm/v3/properties/${item.resource}`,
      );
      const fields: Record<string, any> = {};
      const required: Record<string, string[]> = {
        companies: ["name"],
        deals: ["dealname", "dealstage"],
        tickets: ["subject", "hs_pipeline_stage"],
        tasks: ["hs_task_subject", "hs_timestamp"],
        notes: ["hs_note_body", "hs_timestamp"],
        products: ["name"],
        line_items: ["name"],
        quotes: ["hs_title"],
      };
      for (const [key, label] of Object.entries({
        ...catalog.fields,
        hubspot_owner_id: "Responsable",
      })) {
        const property = properties.results?.find((p: any) => p.name === key);
        if (!property) continue;
        const options = (property.options ?? [])
          .filter((o: any) => !o.hidden && o.value)
          .map((o: any) => ({
            value: String(o.value),
            label: String(o.label).slice(0, 200),
          }))
          .slice(0, 200);
        fields[key] = {
          label,
          ...(property.type === "datetime"
            ? { config: { dateTime: true } }
            : {}),
          ...(required[item.resource]?.includes(key) ? { required: true } : {}),
          type: options.length
            ? "Dropdown"
            : property.type === "number"
              ? "Number"
              : property.type === "datetime"
                ? "Textbox"
                : property.type === "date"
                  ? "DateControl"
                  : key.includes("body") ||
                      key.includes("description") ||
                      key === "content"
                    ? "Textarea"
                    : "Textbox",
          readOnly: Boolean(
            property.modificationMetadata?.readOnlyValue || property.calculated,
          ),
          ...(options.length ? { options } : {}),
        };
      }
      if (
        fields.hubspot_owner_id &&
        conn.scopes.includes("crm.objects.owners.read")
      ) {
        try {
          const owners: any[] = [];
          let after: string | undefined;
          do {
            const result = await remote(
              conn,
              `/crm/v3/owners?${new URLSearchParams({ limit: "100", ...(after ? { after } : {}) })}`,
            );
            owners.push(...(result.results ?? []));
            after = result.paging?.next?.after;
          } while (after && owners.length < 200);
          if (!after)
            fields.hubspot_owner_id = {
              ...fields.hubspot_owner_id,
              type: "Dropdown",
              options: owners.map((o: any) => ({
                value: String(o.id),
                label:
                  [o.firstName, o.lastName].filter(Boolean).join(" ") ||
                  o.email ||
                  String(o.id),
              })),
            };
        } catch (e) {
          if (!(e instanceof HTTPException && [403, 404].includes(e.status)))
            throw e;
        }
      }
      if (["deals", "tickets"].includes(item.resource)) {
        const pipelines = await remote(
          conn,
          `/crm/v3/pipelines/${item.resource}`,
        );
        const pipelineKey =
            item.resource === "deals" ? "pipeline" : "hs_pipeline",
          stageKey =
            item.resource === "deals" ? "dealstage" : "hs_pipeline_stage";
        if (fields[pipelineKey])
          fields[pipelineKey] = {
            ...fields[pipelineKey],
            type: "Dropdown",
            options: (pipelines.results ?? [])
              .map((p: any) => ({ value: p.id, label: p.label }))
              .slice(0, 200),
          };
        if (fields[stageKey])
          fields[stageKey] = {
            ...fields[stageKey],
            type: "Dropdown",
            options: (pipelines.results ?? [])
              .flatMap((p: any) =>
                (p.stages ?? []).map((s: any) => ({
                  value: s.id,
                  label: s.label,
                })),
              )
              .slice(0, 200),
            config: {
              optionsWhen: {
                field: pipelineKey,
                cases: Object.fromEntries(
                  (pipelines.results ?? []).map((p: any) => [
                    p.id,
                    (p.stages ?? []).map((s: any) => s.id),
                  ]),
                ),
              },
            },
          };
      }
      const binding: Binding = {
        kind: "crm",
        accessScope: "tenant",
        provider: "hubspot",
        resource: item.resource,
        principalId: actor.principal.id,
        connectionId: conn.id,
        accountId: conn.externalAccountId!,
        propertyTypes: Object.fromEntries(
          (properties.results ?? [])
            .filter((p: any) => fields[p.name])
            .map((p: any) => [p.name, p.type]),
        ),
        capabilities: item.capabilities,
      };
      const definition = objectSchema.parse({
        name: item.name,
        label: item.label,
        description: "Registros conectados a HubSpot",
        config: {
          version: 2,
          fields,
          fieldOrder: Object.keys(fields),
          studio: {
            collection: {
              kind: "crm",
              sourceId: "hubspot",
              resource: item.resource,
              capabilities: item.capabilities,
            },
            capabilities: item.capabilities,
          },
        },
      });
      if (existing) {
        const old = await getObject(db, tenant, item.name);
        for (const [key, field] of Object.entries(definition.config.fields)) {
          const previous = old.config.fields[key];
          if (previous) {
            const previousConfig = { ...previous.config };
            if (previousConfig.placeholder === "2026-09-11T14:30:00-05:00")
              delete previousConfig.placeholder;
            definition.config.fields[key] = {
              ...field,
              label: [
                (catalog.fields as Record<string, string>)[key],
                `${(catalog.fields as Record<string, string>)[key]} (fecha y hora ISO)`,
              ].includes(previous.label)
                ? field.label
                : previous.label,

              ...(previous.hidden !== undefined
                ? { hidden: previous.hidden }
                : {}),
              config: { ...previousConfig, ...field.config },
            };
          }
        }
        const next = {
          ...old,
          version: (old.version ?? 1) + 1,
          config: {
            ...old.config,
            fields: definition.config.fields,
            fieldOrder: [
              ...(
                old.config.fieldOrder ?? Object.keys(old.config.fields)
              ).filter((k) => definition.config.fields[k]),
              ...Object.keys(definition.config.fields).filter(
                (k) =>
                  !(
                    old.config.fieldOrder ?? Object.keys(old.config.fields)
                  ).includes(k),
              ),
            ],
            studio: {
              ...old.config.studio,
              collection: definition.config.studio?.collection,
              capabilities: item.capabilities,
            },
          },
        };
        statements.push(
          db
            .prepare(
              "UPDATE crm_objects SET config=?,version=? WHERE tenant_id=? AND name=? AND version=?",
            )
            .bind(
              JSON.stringify(next.config),
              next.version,
              tenant,
              item.name,
              old.version,
            ),
          db
            .prepare(
              "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
            )
            .bind(JSON.stringify(binding), tenant, item.name),
          db
            .prepare(
              "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES(?,?,?,?)",
            )
            .bind(tenant, item.name, next.version, JSON.stringify(next)),
        );
        installed.push({ ...item, label: old.label });
        continue;
      }
      statements.push(
        db
          .prepare(
            "INSERT INTO crm_objects(tenant_id,name,label,description,config,version) VALUES(?,?,?,?,?,1)",
          )
          .bind(
            tenant,
            item.name,
            item.label,
            definition.description,
            JSON.stringify(definition.config),
          ),
        db
          .prepare(
            "INSERT INTO crm_collection_bindings(tenant_id,object_name,source_id,resource,config) VALUES(?,?,'hubspot',?,?)",
          )
          .bind(tenant, item.name, item.resource, JSON.stringify(binding)),
        db
          .prepare(
            "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES(?,?,1,?)",
          )
          .bind(
            tenant,
            item.name,
            JSON.stringify({ ...definition, version: 1 }),
          ),
      );
      installed.push(item);
    }
    if ((await connection()).id !== conn.id)
      fail("La conexión cambió. Reintenta la instalación.", 409);
    if (statements.length) await db.batch(statements);
    return c.json({
      data: {
        provider: "hubspot",
        connected: true,
        objects: installed,
        unavailable: discovered.filter((x) => !x.available),
      },
    });
  });
  app.all("/api/*", async (c) => {
    const match = /^\/api\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/(.*))?$/.exec(
      new URL(c.req.url).pathname,
    );
    if (!match) fail("Ruta no disponible.", 404);
    const [, surface, rawName, rawId, extra] = match,
      name = decodeURIComponent(rawName),
      id = rawId ? decodeURIComponent(rawId) : undefined;
    const binding = await crmWorkspaceBinding(db, tenant, name);
    if (!binding) fail("Colección no encontrada.", 404);
    const conn = await connection(binding),
      object = await getObject(db, tenant, name),
      resource = binding.resource;
    if (id && !/^\d+$/.test(id)) fail("Identificador CRM inválido.");
    if (extra && surface !== "record-links")
      fail("Operación no disponible.", 405);
    if (surface === "record-links") {
      if (!id) fail("Identificador requerido.");
      if (extra) {
        if (!["POST", "DELETE"].includes(c.req.method))
          fail("Operación no disponible.", 405);
        const prefix = `hubspot:${name}:`,
          relation = decodeURIComponent(extra);
        if (!relation.startsWith(prefix)) fail("Relación inválida.");
        const targetName = relation.slice(prefix.length),
          target = await crmWorkspaceBinding(db, tenant, targetName);
        if (!target) fail("Colección no encontrada.", 404);
        await connection(target);
        if (
          !capabilities(conn.scopes, resource).update ||
          !capabilities(conn.scopes, target.resource).update
        )
          fail("La conexión no permite editar esta relación.", 403);
        const body = await c.req.json().catch(() => null);
        if (typeof body?.targetId !== "string" || !/^\d+$/.test(body.targetId))
          fail("Identificador inválido.");
        const labels = await remote(
          conn,
          `/crm/v4/associations/${resource}/${target.resource}/labels`,
        );
        if (
          !labels.results?.some(
            (label: any) =>
              label.label === null && label.category === "HUBSPOT_DEFINED",
          )
        )
          fail("Esta relación no admite asociaciones predeterminadas.", 405);
        await remote(conn, `/crm/v3/objects/${resource}/${id}`);
        await remote(
          conn,
          `/crm/v3/objects/${target.resource}/${body.targetId}`,
        );
        await remote(
          conn,
          `/crm/v4/objects/${resource}/${id}/associations/${c.req.method === "POST" ? "default/" : ""}${target.resource}/${body.targetId}`,
          c.req.method === "POST" ? "PUT" : "DELETE",
          c.req.method === "POST" ? {} : undefined,
        );
        return c.json({ data: { sourceId: id, targetId: body.targetId } });
      }
      if (c.req.method !== "GET") fail("Operación no disponible.", 405);
      await remote(conn, `/crm/v3/objects/${resource}/${id}`);
      const rows = await db
        .prepare(
          "SELECT object_name,config FROM crm_collection_bindings WHERE tenant_id=? AND " +
            dialectFor(db).jsonValue("config", "$.kind") +
            "='crm'",
        )
        .bind(tenant)
        .all<{ object_name: string; config: string }>();
      const page = Number(c.req.query("page") ?? 1),
        perPage = Number(c.req.query("perPage") ?? 20);
      const includeRecords = c.req.query("includeRecords") !== "false";
      const includeRecordData = c.req.query("includeRecords") === "true";
      const relationId = c.req.query("relationId");
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(perPage) ||
        perPage < 1 ||
        perPage > 100
      )
        fail("Paginación inválida.");
      const groups: any[] = [];
      await Promise.all(
        rows.results.map(async (row) => {
          const target = JSON.parse(row.config) as Binding;
          const currentRelationId = `hubspot:${name}:${row.object_name}`;
          if (relationId && relationId !== currentRelationId) return;
          if (
            (target.accessScope !== "tenant" &&
              target.principalId !== actor.principal.id) ||
            target.connectionId !== conn.id ||
            target.accountId !== conn.externalAccountId
          )
            return;
          await connection(target);
          let associations: any;
          let defaultAssociation = false;
          try {
            const labels = await remote(
              conn,
              `/crm/v4/associations/${resource}/${target.resource}/labels`,
            );
            if (!labels.results?.length) return;
            defaultAssociation = labels.results.some(
              (label: any) =>
                label.label === null && label.category === "HUBSPOT_DEFINED",
            );
            associations = await remote(
              conn,
              `/crm/v3/objects/${resource}/${id}/associations/${target.resource}?limit=100`,
            );
          } catch (e) {
            if (
              e instanceof HTTPException &&
              [403, 404, 422].includes(e.status)
            )
              return;
            throw e;
          }
          const targetCatalog = hubspotObject(target.resource)!;
          const ids = (associations.results ?? []).map((r: any) =>
            String(r.id),
          );
          let next = associations.paging?.next?.after;
          const seen = new Set<string>();
          while (next) {
            if (seen.has(String(next)) || ids.length >= 5000)
              fail(
                "Esta relación supera el límite de consulta. Ábrela en HubSpot.",
                422,
              );
            seen.add(String(next));
            const more = await remote(
              conn,
              `/crm/v3/objects/${resource}/${id}/associations/${target.resource}?${new URLSearchParams({ limit: "100", after: String(next) })}`,
            );
            ids.push(...(more.results ?? []).map((r: any) => String(r.id)));
            next = more.paging?.next?.after;
          }
          const pageIds = includeRecords
            ? ids.slice((page - 1) * perPage, page * perPage)
            : [];
          const batch = pageIds.length
            ? await remote(
                conn,
                `/crm/v3/objects/${target.resource}/batch/read`,
                "POST",
                {
                  properties: Object.keys(targetCatalog.fields),
                  inputs: pageIds.map((id: string) => ({ id })),
                },
              )
            : { results: [] };
          const targetObject = await getObject(db, tenant, row.object_name);
          groups.push({
            definition: {
              id: `hubspot:${name}:${row.object_name}`,
              sourceObject: name,
              targetObject: row.object_name,
              sourceLabel: targetObject.label,
              targetLabel: object.label,
              cardinality: "many-to-many",
              storage: "native",
            },
            direction: "outgoing",
            targetObject: row.object_name,
            targetLabel: targetObject.label,
            label: targetObject.label,
            records: (batch.results ?? []).map((r: any) => ({
              id: r.id,
              label: r.properties?.[targetCatalog.title] || r.id,
              ...(includeRecordData
                ? {
                    data: {
                      id: r.id,
                      ...Object.fromEntries(
                        Object.keys(targetCatalog.fields).map((key) => [
                          key,
                          r.properties?.[key] ?? null,
                        ]),
                      ),
                      created_at: r.createdAt,
                      updated_at: r.updatedAt,
                    },
                  }
                : {}),
            })),
            targetColumns: Object.entries(targetCatalog.fields).map(
              ([key, label]) => ({ key, label }),
            ),
            total: ids.length,
            canEdit:
              defaultAssociation &&
              capabilities(conn.scopes, resource).update &&
              capabilities(conn.scopes, target.resource).update,
            readOnlyReason: "Asociación nativa de HubSpot.",
            hasNextPage: page * perPage < ids.length,
          });
        }),
      );
      return c.json({ data: groups });
    }
    if (surface === "record-activity" && c.req.method === "GET")
      return c.json({ data: [], total: 0, page: 1 });
    if (!["records", "record-detail"].includes(surface))
      fail("Operación no disponible para HubSpot.", 405);
    const method = c.req.method,
      operation =
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
    if (
      !operation ||
      !capabilities(conn.scopes, resource)[operation] ||
      !binding.capabilities[operation]
    )
      fail("La conexión no anuncia esta operación.", 405);
    const project = (r: any) => ({
      _crmLinks: [
        {
          provider: "hubspot",
          label: "Abrir en HubSpot",
          url: `https://app.hubspot.com/contacts/${binding.accountId}/record/${hubspotObject(resource)!.typeId}/${r.id}`,
        },
      ],
      id: r.id,
      ...Object.fromEntries(
        Object.keys(object.config.fields).map((k) => [
          k,
          r.properties?.[k] ?? null,
        ]),
      ),
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    });
    const properties = Object.keys(object.config.fields);
    if (operation === "list") {
      const page = Number(c.req.query("page") ?? 1),
        limit = Number(c.req.query("perPage") ?? 25),
        q = c.req.query("q");
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 100 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        fail("Paginación inválida (máximo 100 páginas).");
      if (
        c.req.query("filters") ||
        c.req.query("stage") ||
        c.req.query("trash") === "true"
      )
        fail("Este origen no admite esos filtros.");
      let after: string | undefined, result: any;
      for (let current = 1; current <= page; current++) {
        result = q
          ? await remote(conn, `/crm/v3/objects/${resource}/search`, "POST", {
              query: q,
              limit,
              properties,
              ...(after ? { after } : {}),
            })
          : await remote(
              conn,
              `/crm/v3/objects/${resource}?${new URLSearchParams({ limit: String(limit), properties: properties.join(","), ...(after ? { after } : {}) })}`,
            );
        after = result.paging?.next?.after;
        if (current < page && !after) {
          result = { results: [] };
          break;
        }
      }
      return c.json({
        data: (result.results ?? []).map(project),
        page,
        perPage: limit,
        ...(result.total !== undefined ? { total: result.total } : {}),
        pageInfo: { hasNextPage: Boolean(after), hasPreviousPage: page > 1 },
      });
    }
    if (operation === "read") {
      const record = project(
        await remote(
          conn,
          `/crm/v3/objects/${resource}/${id}?${new URLSearchParams({ properties: properties.join(",") })}`,
        ),
      );
      return c.json({
        data:
          surface === "record-detail"
            ? { record, relations: [], page: 1, perPage: 25 }
            : record,
      });
    }
    let values: Record<string, string> = {};
    if (operation !== "delete") {
      const input = await c.req.json().catch(() => null);
      if (!input || typeof input !== "object" || Array.isArray(input))
        fail("Registro inválido.");
      for (const [key, value] of Object.entries(input)) {
        if (
          ["_version", "id", "created_at", "updated_at", "_crmLinks"].includes(
            key,
          )
        )
          continue;
        const field = object.config.fields[key];
        if (!field || field.readOnly)
          fail("El registro contiene un campo no editable.");
        if (
          value !== null &&
          !["string", "number", "boolean"].includes(typeof value)
        )
          fail("Valor de campo inválido.");
        if (
          field.options?.length &&
          value !== null &&
          value !== "" &&
          !field.options.some((o) => o.value === String(value))
        )
          fail(`Valor inválido para ${field.label}.`);
        values[key] = value === null ? "" : String(value);
        if (values[key] && binding.propertyTypes?.[key] === "datetime") {
          if (
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
              values[key],
            ) ||
            !Number.isFinite(Date.parse(values[key]))
          )
            fail(`${field.label}: usa fecha, hora y zona horaria ISO.`);
          values[key] = new Date(values[key]).toISOString();
        }
        if (values[key] && binding.propertyTypes?.[key] === "date") {
          const day = values[key].slice(0, 10);
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
            !Number.isFinite(Date.parse(day)) ||
            new Date(day).toISOString().slice(0, 10) !== day
          )
            fail(`${field.label}: fecha inválida.`);
          values[key] = String(Date.parse(`${day}T00:00:00.000Z`));
        }
      }
      if (operation === "create")
        for (const [key, field] of Object.entries(object.config.fields))
          if (field.required && !field.readOnly && !values[key]?.trim())
            fail(`${field.label}: obligatorio.`);
      if (!Object.keys(values).length) fail("No hay campos para guardar.");
    }
    const result = await remote(
      conn,
      `/crm/v3/objects/${resource}${id ? `/${id}` : ""}`,
      method as any,
      operation === "delete" ? undefined : { properties: values },
    );
    return c.json(
      {
        data: operation === "delete" ? { id, deleted: true } : project(result),
      },
      operation === "create" ? 201 : 200,
    );
  });
  return app;
}
