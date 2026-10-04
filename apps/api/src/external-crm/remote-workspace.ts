import { withCrmOrigins } from "./workspace-origins";
import { studioWorkspaceAdapter } from "./studio-workspace-adapter";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { audit, getObject } from "@savia/studio-server/services";
import { objectSchema, type StudioObject } from "@savia/studio-shared/metadata";
import type { CollectionGatewayContext } from "../studio/collection-gateway";
import { createCrmRepository } from "./repository";
import { canAccessSharedCrm, canManageSharedCrm } from "./hubspot-access";
import {
  CrmUnavailableError,
  CrmUpstreamError,
  type ActiveCrmConnection,
} from "./contracts";
import {
  createRemoteWorkspaceAdapter,
  type RemoteProviderId,
  type WorkspaceResource,
  type WorkspaceCapabilities,
  type WorkspaceDescription,
} from "./workspace-adapter";

const providerNames = {
  salesforce: "Salesforce",
  zoho: "Zoho CRM",
  pipedrive: "Pipedrive",
} as const;
function isProvider(value: unknown): value is RemoteProviderId {
  return typeof value === "string" && Object.hasOwn(providerNames, value);
}
function fail(
  message: string,
  status: 403 | 404 | 405 | 409 | 422 | 502 | 503 = 422,
): never {
  throw new HTTPException(status, { message });
}
type Binding = {
  kind: "crm";
  provider: RemoteProviderId;
  resource: WorkspaceResource;
  accessScope?: "tenant";
  principalId: string;
  connectionId: string;
  accountId: string;
  capabilities: WorkspaceCapabilities;
};
async function bindingFor(
  context: CollectionGatewayContext,
  name: string,
): Promise<Binding | undefined> {
  const row = await context.db
    .prepare(
      "SELECT config FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
    )
    .bind(context.tenant, name)
    .first<{ config: string }>();
  if (!row) return undefined;
  const binding = JSON.parse(row.config);
  return binding?.kind === "crm" && isProvider(binding.provider)
    ? binding
    : undefined;
}
export async function handlesRemoteWorkspace(
  context: CollectionGatewayContext,
  path: string,
) {
  if (
    /^\/api\/crm-workspace\/[^/]+(?:\/install)?$/.test(path) &&
    path !== "/api/crm-workspace/install"
  )
    return true;
  const match =
    /^\/api\/(?:records|record-detail|record-activity|record-notes|record-links|files|import|export)\/([^/]+)/.exec(
      path,
    );
  return Boolean(
    match && (await bindingFor(context, decodeURIComponent(match[1]))),
  );
}
function paging(url: URL) {
  const page = Number(url.searchParams.get("page") ?? 1);
  const perPage = Number(url.searchParams.get("perPage") ?? 25);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100 ||
    !Number.isSafeInteger(perPage) ||
    perPage < 1 ||
    perPage > 100
  )
    fail("Invalid pagination (maximum 100 pages and 100 records per page).");
  return { page, perPage };
}
function validateValues(
  input: unknown,
  installed: StudioObject,
  current: WorkspaceDescription,
  create: boolean,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Invalid CRM record.");
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      ["id", "_version", "created_at", "updated_at", "_crmLinks"].includes(key)
    )
      continue;
    const field = current.fields[key];
    if (
      !field ||
      !installed.config.fields[key] ||
      field.readOnly ||
      installed.config.fields[key].readOnly
    )
      fail("The record contains a field that cannot be edited.");
    if (
      value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    )
      fail("Invalid field value.");
    if (typeof value === "number" && !Number.isFinite(value))
      fail("Invalid number.");
    if (
      field.options?.length &&
      value !== null &&
      value !== "" &&
      !field.options.some((option) => option.value === String(value))
    )
      fail(`Invalid value for ${field.label}.`);
    if (field.required && (value === null || String(value).trim() === ""))
      fail(`${field.label} is required.`);
    values[key] = value;
  }
  if (create)
    for (const [key, field] of Object.entries(current.fields))
      if (
        field.required &&
        !field.readOnly &&
        (values[key] === undefined ||
          values[key] === null ||
          String(values[key]).trim() === "")
      )
        fail(
          `${field.label} is required. Reinstall this screen if its fields have changed.`,
        );
  if (!Object.keys(values).length) fail("No fields to save.");
  return values;
}
export function createRemoteWorkspaceApp(context: CollectionGatewayContext) {
  const { db, tenant, actor } = context;
  const tenantId = Number(tenant.replace(/^(?:agency|tenant):/, ""));
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json({ error: error.message }, error.status);
    if (error instanceof CrmUnavailableError)
      return c.json({ error: "This CRM integration is unavailable." }, 503);
    if (error instanceof CrmUpstreamError) {
      const status =
        error.code === "RECONNECT_REQUIRED"
          ? 409
          : error.status === 403
            ? 403
            : error.status === 404
              ? 404
              : error.status === 400 || error.status === 422
                ? 422
                : error.status === 429
                  ? 429
                  : 502;
      return c.json(
        {
          error:
            status === 409
              ? "Reconnect the CRM account."
              : status === 429
                ? "The CRM rate limit was reached. Try again later."
                : "The CRM could not complete this operation.",
        },
        status,
      );
    }
    return c.json({ error: "The CRM could not complete this operation." }, 502);
  });
  app.use("*", async (c, next) => {
    if (!canAccessSharedCrm(actor, tenant))
      fail("You do not have access to this tenant.", 403);
    if (c.req.method !== "GET" && !canManageSharedCrm(actor, tenant))
      fail("Tenant administration access is required.", 403);
    await next();
  });
  function adapter(provider: RemoteProviderId) {
    if (!context.crm) fail("CRM integration is unavailable.", 503);
    const nango = context.crm.nango;
    return studioWorkspaceAdapter(
      withCrmOrigins(
        createRemoteWorkspaceAdapter(provider, {
          ...nango,
          async proxy(request) {
            const response = await nango.proxy(request);
            await audit(
              db,
              tenant,
              `${provider}.${request.method === "GET" ? "read" : "write"}`,
              provider,
              null,
              {
                principalId: actor.principal.id,
                connectionId: request.connection.id,
                method: request.method,
                status: response.status,
              },
            ).run();
            return response;
          },
        }),
        provider,
        nango,
      ),
    );
  }
  async function connection(
    provider: RemoteProviderId,
    binding?: Binding,
    name?: string,
  ) {
    if (
      binding &&
      (binding.provider !== provider ||
        !["contacts", "companies", "deals"].includes(binding.resource) ||
        name !== `${provider}_${binding.resource}`)
    )
      fail("Invalid CRM collection binding.", 403);
    if (
      binding &&
      binding.accessScope !== "tenant" &&
      binding.principalId !== actor.principal.id
    )
      fail("This CRM collection belongs to another user.", 403);
    if (
      binding &&
      (!binding.principalId || !binding.connectionId || !binding.accountId)
    )
      fail("Invalid CRM collection binding.", 403);
    const current = await createCrmRepository(db).findActiveConnection(
      tenantId,
      provider,
      binding?.principalId ?? actor.principal.id,
    );
    if (
      !current ||
      current.status !== "connected" ||
      !current.externalAccountId
    )
      fail("Reconnect the CRM account.", 409);
    if (
      current.provider !== provider ||
      (binding &&
        (current.id !== binding.connectionId ||
          current.externalAccountId !== binding.accountId))
    )
      fail(
        "The CRM collection account has changed. An administrator must review it.",
        403,
      );
    return current;
  }
  async function discover(
    provider: RemoteProviderId,
    conn: ActiveCrmConnection,
  ) {
    const remote = adapter(provider);
    return Promise.all(
      remote.resources.map(async (item) => {
        const name = `${provider}_${item.resource}`;
        const binding = await bindingFor(context, name);
        const installedOwner =
          binding &&
          (binding.accessScope === "tenant" ||
            binding.principalId === actor.principal.id)
            ? await createCrmRepository(db).findActiveConnection(
                tenantId,
                provider,
                binding.principalId,
              )
            : undefined;
        const installed = Boolean(
          binding &&
          installedOwner?.status === "connected" &&
          binding.accountId === conn.externalAccountId &&
          binding.accountId === installedOwner.externalAccountId &&
          binding.connectionId === installedOwner.id &&
          binding.provider === provider &&
          binding.resource === item.resource,
        );
        try {
          const description = await remote.describe(conn, item.resource);
          return {
            ...item,
            name,
            installed,
            available:
              description.capabilities.list && description.capabilities.read,
            capabilities: description.capabilities,
          };
        } catch (error) {
          if (
            (error instanceof HTTPException ||
              error instanceof CrmUpstreamError) &&
            [403, 404, 405].includes(error.status ?? 0)
          )
            return {
              ...item,
              name,
              installed,
              available: false,
              reason: "This account cannot access the resource.",
            };
          throw error;
        }
      }),
    );
  }
  app.get("/api/crm-workspace/:provider", async (c) => {
    const provider = c.req.param("provider");
    if (!isProvider(provider)) fail("Unknown CRM provider.", 404);
    const current = await createCrmRepository(db).findActiveConnection(
      tenantId,
      provider,
      actor.principal.id,
    );
    if (!current || current.status !== "connected")
      return c.json({ data: { provider, connected: false, objects: [] } });
    const conn = await connection(provider);
    return c.json({
      data: {
        provider,
        connected: true,
        accountLabel: conn.externalAccountLabel,
        objects: await discover(provider, conn),
      },
    });
  });
  app.post("/api/crm-workspace/:provider/install", async (c) => {
    const provider = c.req.param("provider");
    if (!isProvider(provider)) fail("Unknown CRM provider.", 404);
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "resources") ||
      !Array.isArray(body.resources) ||
      !body.resources.length ||
      body.resources.length > 3 ||
      new Set(body.resources).size !== body.resources.length ||
      !body.resources.every(
        (resource: unknown) =>
          typeof resource === "string" &&
          ["contacts", "companies", "deals"].includes(resource),
      )
    )
      fail("Select a non-empty list of distinct CRM resources.");
    const resources = body.resources as WorkspaceResource[];
    const remote = adapter(provider),
      conn = await connection(provider);
    const statements: D1PreparedStatement[] = [],
      installed: unknown[] = [];
    for (const resource of resources) {
      const item = remote.resources.find((item) => item.resource === resource);
      if (!item) fail("Unsupported resource.");
      const description = await remote.describe(conn, resource);
      if (!description.capabilities.list || !description.capabilities.read)
        fail("This CRM resource is unavailable.", 403);
      const name: string = `${provider}_${resource}`;
      const existing: { name: string } | null = await db
        .prepare("SELECT name FROM studio_objects WHERE tenant_id=? AND name=?")
        .bind(tenant, name)
        .first<{ name: string }>();
      const binding: Binding | undefined = existing
        ? await bindingFor(context, name)
        : undefined;
      if (
        existing &&
        (!binding ||
          binding.provider !== provider ||
          binding.resource !== resource ||
          binding.principalId !== actor.principal.id ||
          binding.accountId !== conn.externalAccountId)
      )
        fail(
          "A collection with this name belongs to another source or account.",
          409,
        );
      const nextBinding: Binding = {
        kind: "crm",
        ...(!binding || binding.accessScope === "tenant"
          ? { accessScope: "tenant" as const }
          : {}),
        provider,
        resource,
        principalId: actor.principal.id,
        connectionId: conn.id,
        accountId: conn.externalAccountId!,
        capabilities: description.capabilities,
      };
      let definition = objectSchema.parse({
        name,
        label: item.label,
        description: `Records connected to ${providerNames[provider]}`,
        config: {
          version: 2,
          fields: description.fields,
          fieldOrder: Object.keys(description.fields),
          studio: {
            collection: {
              kind: "crm",
              sourceId: provider,
              resource,
              schemaIssues: description.schemaIssues,
              capabilities: description.capabilities,
            },
            capabilities: description.capabilities,
          },
        },
      });
      let version = 1;
      if (existing) {
        const old = await getObject(db, tenant, name);
        for (const [key, field] of Object.entries(definition.config.fields)) {
          const previous = old.config.fields[key];
          if (previous)
            definition.config.fields[key] = {
              ...field,
              label: previous.label,
              ...(previous.hidden === undefined
                ? {}
                : { hidden: previous.hidden }),
            };
        }
        version = (old.version ?? 1) + 1;
        definition = {
          ...definition,
          label: old.label,
          description: old.description,
          config: {
            ...old.config,
            fields: definition.config.fields,
            fieldOrder: [
              ...(old.config.fieldOrder ?? []).filter(
                (key) => definition.config.fields[key],
              ),
              ...Object.keys(definition.config.fields).filter(
                (key) => !old.config.fieldOrder?.includes(key),
              ),
            ],
            studio: { ...old.config.studio, ...definition.config.studio },
          },
        };
        statements.push(
          db
            .prepare(
              "UPDATE studio_objects SET config=?,version=? WHERE tenant_id=? AND name=?",
            )
            .bind(JSON.stringify(definition.config), version, tenant, name),
          db
            .prepare(
              "UPDATE crm_collection_bindings SET config=? WHERE tenant_id=? AND object_name=?",
            )
            .bind(JSON.stringify(nextBinding), tenant, name),
        );
      } else {
        statements.push(
          db
            .prepare(
              "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES(?,?,?,?,?,1)",
            )
            .bind(
              tenant,
              name,
              definition.label,
              definition.description,
              JSON.stringify(definition.config),
            ),
          db
            .prepare(
              "INSERT INTO crm_collection_bindings(tenant_id,object_name,source_id,resource,config) VALUES(?,?,?,?,?)",
            )
            .bind(
              tenant,
              name,
              provider,
              resource,
              JSON.stringify(nextBinding),
            ),
        );
      }
      statements.push(
        db
          .prepare(
            "INSERT INTO studio_schema_versions(tenant_id,object_name,version,definition) VALUES(?,?,?,?)",
          )
          .bind(
            tenant,
            name,
            version,
            JSON.stringify({ ...definition, version }),
          ),
      );
      installed.push({
        resource,
        name,
        label: definition.label,
        available: true,
        installed: true,
        capabilities: description.capabilities,
      });
    }
    const current = await connection(provider);
    if (
      current.id !== conn.id ||
      current.externalAccountId !== conn.externalAccountId
    )
      fail("The CRM account changed. Retry installation.", 409);
    if (statements.length) await db.batch(statements);
    return c.json({
      data: {
        provider,
        connected: true,
        accountLabel: conn.externalAccountLabel,
        objects: installed,
        unavailable: [],
      },
    });
  });
  app.all("/api/*", async (c) => {
    const match = /^\/api\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/(.*))?$/.exec(
      new URL(c.req.url).pathname,
    );
    if (!match) fail("Unknown CRM operation.", 404);
    const [, surface, rawName, rawId, extra] = match,
      name = decodeURIComponent(rawName),
      id = rawId ? decodeURIComponent(rawId) : undefined;
    const binding = await bindingFor(context, name);
    if (!binding) fail("CRM collection not found.", 404);
    const conn = await connection(binding.provider, binding, name),
      remote = adapter(binding.provider);
    const object = await getObject(db, tenant, name),
      description = await remote.describe(conn, binding.resource);
    if (id && !/^[a-zA-Z0-9]{1,80}$/.test(id)) fail("Invalid CRM identifier.");
    if (extra && surface !== "record-links")
      fail("Unsupported CRM operation.", 405);
    const fields = Object.keys(object.config.fields).filter(
      (key) => description.fields[key],
    );
    const project = (record: Record<string, unknown>) => {
      const link = remote.origin?.(conn, binding.resource, String(record.id));
      return {
        id: record.id,
        ...Object.fromEntries(fields.map((key) => [key, record[key] ?? null])),
        ...(record.created_at === undefined
          ? {}
          : { created_at: record.created_at }),
        ...(record.updated_at === undefined
          ? {}
          : { updated_at: record.updated_at }),
        ...(link ? { _crmLinks: [link] } : {}),
      };
    };
    if (surface === "record-links") {
      if (!id || !description.capabilities.read || !binding.capabilities.read)
        fail("CRM relations are unavailable.", 405);
      const page = paging(new URL(c.req.url));
      await remote.get(conn, binding.resource, id, fields);
      const rows = await db
        .prepare(
          "SELECT object_name,config FROM crm_collection_bindings WHERE tenant_id=?",
        )
        .bind(tenant)
        .all<{ object_name: string; config: string }>();
      const relationId = extra
        ? decodeURIComponent(extra)
        : c.req.query("relationId");
      const groups: unknown[] = [];
      if (!extra && c.req.method !== "GET")
        fail("Unsupported relation operation.", 405);
      for (const row of rows.results) {
        const target = JSON.parse(row.config) as Binding;
        const relation = `${binding.provider}:${name}:${row.object_name}`;
        if (
          row.object_name === name ||
          (relationId && relationId !== relation) ||
          target.kind !== "crm" ||
          target.provider !== binding.provider ||
          target.connectionId !== binding.connectionId ||
          target.accountId !== binding.accountId ||
          (target.accessScope !== "tenant" &&
            target.principalId !== actor.principal.id)
        )
          continue;
        await connection(target.provider, target, row.object_name);
        const targetObject = await getObject(db, tenant, row.object_name);
        const targetDescription = await remote.describe(conn, target.resource);
        if (!targetDescription.capabilities.read || !target.capabilities.read)
          continue;
        if (extra) {
          if (
            !remote.setLink ||
            !remote.canEditLink?.(binding.resource, target.resource) ||
            !["POST", "DELETE"].includes(c.req.method) ||
            !binding.capabilities.update ||
            !description.capabilities.update
          )
            fail("This relationship cannot be edited.", 405);
          const body = await c.req.json().catch(() => null);
          if (
            typeof body?.targetId !== "string" ||
            !/^[a-zA-Z0-9]{1,80}$/.test(body.targetId)
          )
            fail("Invalid target identifier.");
          await remote.get(
            conn,
            target.resource,
            body.targetId,
            Object.keys(targetDescription.fields),
          );
          await remote.setLink(
            conn,
            binding.resource,
            id,
            target.resource,
            body.targetId,
            c.req.method === "DELETE",
          );
          return c.json({ data: { sourceId: id, targetId: body.targetId } });
        }
        try {
          const result = await remote.links(
            conn,
            binding.resource,
            id,
            target.resource,
            {
              ...page,
              fields: Object.keys(targetObject.config.fields).filter(
                (key) => targetDescription.fields[key],
              ),
            },
          );
          groups.push({
            definition: {
              id: relation,
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
            records:
              c.req.query("includeRecords") === "false"
                ? []
                : result.records.map((record) => ({
                    id: String(record.id),
                    label: String(record[targetDescription.title] ?? record.id),
                    ...(c.req.query("includeRecords") === "true"
                      ? { data: record }
                      : {}),
                  })),
            targetColumns: Object.entries(targetObject.config.fields).map(
              ([key, field]) => ({ key, label: field.label }),
            ),
            ...(result.total === undefined ? {} : { total: result.total }),
            hasNextPage: result.hasNextPage,
            canEdit: Boolean(
              remote.setLink &&
              remote.canEditLink?.(binding.resource, target.resource) &&
              description.capabilities.update &&
              binding.capabilities.update &&
              canManageSharedCrm(actor, tenant),
            ),
            readOnlyReason: `Native ${providerNames[binding.provider]} relationship.`,
          });
        } catch (error) {
          if (!(error instanceof HTTPException && error.status === 405))
            throw error;
        }
      }
      if (extra) fail("Relationship not found.", 404);
      return c.json({ data: groups });
    }
    if (!["records", "record-detail"].includes(surface))
      fail("Unsupported CRM operation.", 405);
    const operation =
      c.req.method === "GET"
        ? id
          ? "read"
          : "list"
        : c.req.method === "POST" && !id
          ? "create"
          : c.req.method === "PATCH" && id
            ? "update"
            : undefined;
    if (
      !operation ||
      !description.capabilities[operation] ||
      !binding.capabilities[operation]
    )
      fail("This CRM operation is not available.", 405);
    if (operation === "list") {
      const url = new URL(c.req.url),
        page = paging(url);
      if (
        url.searchParams.has("filters") ||
        url.searchParams.has("stage") ||
        url.searchParams.get("trash") === "true" ||
        url.searchParams.has("sort")
      )
        fail("This CRM source does not support these filters or ordering.");
      const q = c.req.query("q");
      if (q && (q.length > 200 || !description.capabilities.search))
        fail("Unsupported CRM search.");
      const result = await remote.list(conn, binding.resource, {
        ...page,
        q,
        fields,
      });
      return c.json({
        data: result.records.map(project),
        ...page,
        ...(result.total === undefined ? {} : { total: result.total }),
        pageInfo: {
          hasNextPage: result.hasNextPage,
          hasPreviousPage: page.page > 1,
        },
      });
    }
    if (operation === "read") {
      const record = project(
        await remote.get(conn, binding.resource, id!, fields),
      );
      return c.json({
        data:
          surface === "record-detail"
            ? { record, relations: [], page: 1, perPage: 25 }
            : record,
      });
    }
    const values = validateValues(
      await c.req.json().catch(() => null),
      object,
      description,
      operation === "create",
    );
    const record =
      operation === "create"
        ? await remote.create(conn, binding.resource, values)
        : await remote.update(conn, binding.resource, id!, values);
    return c.json(
      { data: project(record) },
      operation === "create" ? 201 : 200,
    );
  });
  return app;
}
