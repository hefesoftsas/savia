import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import { createCrmRepository } from "../src/external-crm/repository";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { authenticationMiddleware } from "../src/auth/middleware";
import type { AppActor } from "../src/auth/types";
import type { CrmProviderId } from "../src/external-crm/contracts";
import {
  registerCrmRoutes,
  type CrmRouteDependencies,
} from "../src/routes/crm";
import { createCrmProviderRegistry } from "../src/external-crm/providers";
const migrationFiles = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
const migrations = migrationFiles.map(([, sql]) => sql);
beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});
let counter = 880000;
async function setup() {
  const tenant = ++counter;
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(tenant, `crm-${tenant}`, "CRM tenant", "2026-10-03", "2026-10-03")
    .run();
  const actors = await Promise.all(
    ["owner", "other"].map(
      async (name) =>
        ({
          principal: await upsertPrincipal(env.DB, {
            issuer: "test",
            subject: `${tenant}-${name}`,
            email: `${tenant}-${name}@crm.test`,
            displayName: name,
          }),
          globalRoles: [],
          memberships: [
            {
              id: `m-${name}`,
              principalId: "unused",
              agencyId: tenant,
              tenantId: tenant,
              role: "tenant_admin",
              isActive: true,
              createdAt: "",
              updatedAt: "",
            },
          ],
        }) as AppActor,
    ),
  );
  const repository = createCrmRepository(env.DB);
  const completion = (
    actor = actors[0],
    provider: CrmProviderId = "hubspot",
    agencyId = tenant,
  ) => ({
    agencyId,
    actor,
    provider,
    nangoConnectionId: `nango-${agencyId}-${actor.principal.id}-${provider}`,
    nangoIntegrationId: provider,
    status: "connected" as const,
    externalAccountId: "account",
  });
  const nango = {
    createConnectSession: vi.fn(async () => ({
      token: "token",
      expiresAt: "later",
      connectUrl: "https://nango.test",
      apiUrl: "https://nango.test",
    })),
    getConnection: vi.fn(async (connectionId: string, provider: string) => ({
      connectionId,
      providerConfigKey: provider,
      organizationId: `user:${actors[0].principal.id}`,
      scopes: [],
    })),
    deleteConnection: vi.fn(async () => {}),
    proxy: vi.fn(),
  };
  const validate = vi.fn(async () => ({
    externalAccountId: "account",
    externalAccountLabel: "Account",
    scopes: [],
  }));
  const providers = createCrmProviderRegistry({
    baseUrl: "https://nango.test",
    apiKey: "test",
    hubspotIntegrationId: "hubspot",
    salesforceIntegrationId: "salesforce",
    zohoIntegrationId: "zoho",
    pipedriveIntegrationId: "pipedrive",
  });
  function app(actor = actors[0]) {
    const a = new OpenAPIHono();
    a.use(
      "*",
      authenticationMiddleware(env.DB, { authenticate: async () => actor }),
    );
    registerCrmRoutes(a, env.DB, {
      nango,
      providers,
      adapters: Object.fromEntries(
        Object.keys(providers).map((p) => [p, { validate }]),
      ),
    } as unknown as CrmRouteDependencies);
    return a;
  }
  return { tenant, actors, repository, completion, nango, validate, app };
}
function post(
  app: ReturnType<Awaited<ReturnType<typeof setup>>["app"]>,
  provider: string,
  action: string,
  body: unknown,
) {
  return app.request(`/v1/crm/connections/${provider}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
it("rejects a second provider or a second owner in the same organization", async () => {
  const s = await setup();
  const first = await s.repository.saveConnection(s.completion());
  for (const completion of [
    s.completion(s.actors[0], "salesforce"),
    s.completion(s.actors[1], "hubspot"),
  ])
    await expect(s.repository.saveConnection(completion)).rejects.toMatchObject(
      { code: "CRM_ORGANIZATION_CONNECTION_EXISTS" },
    );
  expect(
    (
      await s.repository.listConnections(s.tenant, s.actors[0].principal.id)
    ).map((c) => c.id),
  ).toEqual([first.id]);
});
it("allows separate organizations for the same owner without retargeting an existing connection", async () => {
  const s = await setup(),
    other = await setup();
  const first = await s.repository.saveConnection(s.completion());
  const second = await s.repository.saveConnection(
    s.completion(s.actors[0], "hubspot", other.tenant),
  );
  expect(second.agencyId).toBe(other.tenant);
  expect(second.id).not.toBe(first.id);
});
it("keeps reconnect-required slots occupied until explicit disconnection", async () => {
  const s = await setup();
  const c = await s.repository.saveConnection(s.completion());
  await s.repository.markReconnectRequired(c.id, s.actors[0].principal.id);
  await expect(
    s.repository.saveConnection(s.completion(s.actors[0], "zoho")),
  ).rejects.toMatchObject({ code: "CRM_ORGANIZATION_CONNECTION_EXISTS" });
  await s.repository.markDisconnected(
    s.tenant,
    "hubspot",
    s.actors[0].principal.id,
  );
  expect(
    (await s.repository.saveConnection(s.completion(s.actors[0], "zoho")))
      .provider,
  ).toBe("zoho");
});
it("enforces organization uniqueness for concurrent writes and direct SQL", async () => {
  const s = await setup();
  const results = await Promise.allSettled([
    s.repository.saveConnection(s.completion()),
    s.repository.saveConnection(s.completion(s.actors[1], "pipedrive")),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CRM_ORGANIZATION_CONNECTION_EXISTS" },
  });
  await expect(
    env.DB.prepare(
      "INSERT INTO tenant_crm_connections(id,tenant_id,created_by_principal_id,provider,nango_connection_id,nango_integration_id,status,created_at,updated_at) VALUES(?,?,?,'zoho','direct','zoho','connected','now','now')",
    )
      .bind(crypto.randomUUID(), s.tenant, s.actors[1].principal.id)
      .run(),
  ).rejects.toThrow();
});
it("blocks sessions and completion before calling Nango when the organization is occupied", async () => {
  const s = await setup();
  await s.repository.saveConnection(s.completion());
  for (const [actor, provider] of [
    [s.actors[0], "salesforce"],
    [s.actors[1], "hubspot"],
  ] as const)
    for (const action of ["connect-session", "complete"]) {
      const response = await post(s.app(actor), provider, action, {
        agencyId: s.tenant,
        connectionId: "candidate",
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "CRM_ORGANIZATION_CONNECTION_EXISTS" },
      });
    }
  expect(s.nango.createConnectSession).not.toHaveBeenCalled();
  expect(s.nango.getConnection).not.toHaveBeenCalled();
});
it("exposes only organization policy to another member, not owner account details", async () => {
  const s = await setup();
  await s.repository.saveConnection(s.completion());
  const response = await s
    .app(s.actors[1])
    .request(`/v1/crm/providers?agencyId=${s.tenant}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.data).toHaveLength(4);
  for (const p of body.data)
    expect(p.attributes).toMatchObject({
      connectionBlocked: true,
      activeProvider: "hubspot",
    });
  expect(JSON.stringify(body)).not.toContain(s.actors[0].principal.id);
  const owner = (await (
    await s.app().request(`/v1/crm/providers?agencyId=${s.tenant}`)
  ).json()) as any;
  expect(
    owner.data.find((p: any) => p.id === "hubspot").attributes
      .connectionBlocked,
  ).toBe(false);
});
it("permits owner reconnection and refuses an unauthorized organization", async () => {
  const s = await setup(),
    other = await setup();
  const first = await s.repository.saveConnection(s.completion());
  const reconnected = await s.repository.saveConnection({
    ...s.completion(),
    nangoConnectionId: "new-token-reference",
  });
  expect(reconnected.id).toBe(first.id);
  expect(
    (
      await post(s.app(), "hubspot", "reconnect-session", {
        agencyId: s.tenant,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post(s.app(), "hubspot", "complete", {
        agencyId: other.tenant,
        connectionId: "candidate",
      })
    ).status,
  ).toBe(403);
});

it("returns a conflict when two completions finish OAuth concurrently", async () => {
  const s = await setup();
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.validate.mockImplementation(async () => {
    if (++arrived === 2) release();
    await ready;
    return {
      externalAccountId: "account",
      externalAccountLabel: "Account",
      scopes: [],
    };
  });
  const results = await Promise.all(
    ["hubspot", "salesforce"].map((provider) =>
      post(s.app(), provider, "complete", {
        agencyId: s.tenant,
        connectionId: provider,
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await results.find((r) => r.status === 409)!.json()).toMatchObject({
    error: { code: "CRM_ORGANIZATION_CONNECTION_EXISTS" },
  });
});

it("fails migration on existing duplicates without deleting or selecting an account", async () => {
  const s = await setup();
  await env.DB.exec(
    "DROP INDEX tenant_crm_connections_organization_active_unique",
  );
  await s.repository.saveConnection(s.completion());
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO tenant_crm_connections(id,tenant_id,created_by_principal_id,provider,nango_connection_id,nango_integration_id,status,created_at,updated_at) VALUES(?,?,?,'zoho','direct','zoho','connected','now','now')",
  )
    .bind(id, s.tenant, s.actors[1].principal.id)
    .run();
  const migration = migrationFiles
    .find(([path]) =>
      path.endsWith("/0030_crm_organization_connection.sql"),
    )![1]
    .split("--> statement-breakpoint")[0];
  try {
    await expect(
      env.DB.exec(
        migration
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM tenant_crm_connections WHERE tenant_id=? AND disconnected_at IS NULL",
      )
        .bind(s.tenant)
        .first("n"),
    ).toBe(2);
  } finally {
    await env.DB.prepare("DELETE FROM tenant_crm_connections WHERE id=?")
      .bind(id)
      .run();
    await env.DB.exec(
      migration
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
});

it("refreshes only the selected organization's collection bindings after reconnection", async () => {
  const s = await setup(),
    other = await setup();
  for (const tenant of [s.tenant, other.tenant]) {
    await env.DB.prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,'hubspot_contacts','Contacts','{}')",
    )
      .bind(`tenant:${tenant}`)
      .run();
    await env.DB.prepare(
      "INSERT INTO crm_collection_bindings(tenant_id,object_name,source_id,resource,config) VALUES(?,'hubspot_contacts','hubspot','contacts',?)",
    )
      .bind(
        `tenant:${tenant}`,
        JSON.stringify({
          principalId: s.actors[0].principal.id,
          provider: "hubspot",
          accountId: "account",
          connectionId: "old",
        }),
      )
      .run();
  }
  const response = await post(s.app(), "hubspot", "complete", {
    agencyId: s.tenant,
    connectionId: "new-nango",
  });
  expect(response.status).toBe(200);
  const document = (await response.json()) as any;
  const read = async (tenant: number) =>
    JSON.parse(
      String(
        await env.DB.prepare(
          "SELECT config FROM crm_collection_bindings WHERE tenant_id=?",
        )
          .bind(`tenant:${tenant}`)
          .first("config"),
      ),
    );
  expect((await read(s.tenant)).connectionId).toBe(document.data.id);
  expect((await read(other.tenant)).connectionId).toBe("old");
});

it("rejects reusing one Nango connection across organizations", async () => {
  const s = await setup(),
    other = await setup();
  const first = await s.repository.saveConnection(s.completion());
  await expect(
    s.repository.saveConnection({
      ...s.completion(s.actors[0], "hubspot", other.tenant),
      nangoConnectionId: first.nangoConnectionId,
    }),
  ).rejects.toMatchObject({ code: "CRM_CONNECTION_ALREADY_ASSIGNED" });
  expect(
    await s.repository.listConnections(other.tenant, s.actors[0].principal.id),
  ).toEqual([]);
});
