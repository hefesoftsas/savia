import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import {
  platformAdministratorAuthenticator,
  agencyAdministratorAuthenticator,
} from "./auth-fixtures";
import type { SaviaRequestService } from "../src/routes/savia-request";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, s]) => s);

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

let counter = 995000;
async function tenant() {
  const id = ++counter,
    slug = "purge-" + id,
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(id, slug, "Purge agency", now, now)
    .run();
  return id;
}

describe("tenant deletion purges Savia Request overlays", () => {
  it("purges both tenant scopes after deleting the record", async () => {
    const id = await tenant();
    const fetch = vi.fn(async () => Response.json({ tenant: "x", purged: {} }));
    const app = createTestApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
      saviaRequestService: { fetch } as SaviaRequestService,
    });

    const response = await app.request(`https://api.test/v1/tenants/${id}`, {
      method: "DELETE",
    });
    expect(response.status, await response.clone().text()).toBe(204);
    expect(
      await env.DB.prepare("SELECT id FROM tenants WHERE id=?")
        .bind(id)
        .first(),
    ).toBe(null);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      fetch.mock.calls.map(([request]) => [request.method, request.url]),
    ).toEqual([
      [
        "DELETE",
        `https://savia-request.internal/api/admin/tenants/tenant:${id}`,
      ],
    ]);
  });

  it("still deletes the tenant when the purge fails", async () => {
    const id = await tenant();
    const errors: unknown[] = [];
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });
    try {
      const app = createTestApp({
        auth: platformAdministratorAuthenticator(),
        documents: env.DOCUMENTS,
        saviaRequestService: {
          fetch: () => Promise.reject(new Error("worker caído")),
        },
      });
      const response = await app.request(`https://api.test/v1/tenants/${id}`, {
        method: "DELETE",
      });
      expect(response.status, await response.clone().text()).toBe(204);
      expect(
        await env.DB.prepare("SELECT id FROM tenants WHERE id=?")
          .bind(id)
          .first(),
      ).toBe(null);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("deletes without purge when the service is unavailable", async () => {
    const id = await tenant();
    const app = createTestApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
    const response = await app.request(`https://api.test/v1/tenants/${id}`, {
      method: "DELETE",
    });
    expect(response.status, await response.clone().text()).toBe(204);
  });
});

const successfulPurge: SaviaRequestService = {
  fetch: async () => Response.json({ purged: {} }),
};
function createCascadeApp(options: Parameters<typeof createTestApp>[0] = {}) {
  return createTestApp({
    auth: platformAdministratorAuthenticator(),
    documents: env.DOCUMENTS,
    saviaRequestService: successfulPurge,
    ...options,
  });
}

describe("explicit tenant cascade deletion", () => {
  const cascadeUrl = (id: number, confirmation = "Purge agency") =>
    `https://api.test/v1/tenants/${id}?cascade=true&confirmation=${encodeURIComponent(confirmation)}`;

  it("requires the current tenant name before removing anything", async () => {
    const id = await tenant();
    const app = createCascadeApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
    const response = await app.request(cascadeUrl(id, "wrong name"), {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
    expect(
      await env.DB.prepare("SELECT id FROM tenants WHERE id=?")
        .bind(id)
        .first(),
    ).not.toBeNull();
  });

  it("removes related records and files while preserving another tenant and shared principals", async () => {
    const id = await tenant(),
      other = await tenant();
    const scope = `tenant:${id}`,
      otherScope = `tenant:${other}`;
    await env.DB.prepare(
      "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
    )
      .bind(
        `principal-${id}`,
        "test",
        `principal-${id}`,
        `${id}@test.example`,
        "Shared account",
        "now",
        "now",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,'now','now')",
    )
      .bind(`membership-${id}`, `principal-${id}`, id)
      .run();
    for (const tenantScope of [scope, otherScope]) {
      await env.DB.prepare(
        "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,'items','Items','{}')",
      )
        .bind(tenantScope)
        .run();
      await env.DB.prepare(
        "INSERT INTO studio_records(tenant_id,id,object_name,data) VALUES(?,'record','items','{}')",
      )
        .bind(tenantScope)
        .run();
      await env.DB.prepare(
        "INSERT INTO studio_file_drafts(id,tenant_id,object_name,field_name,name,mime,size,storage_key,expires_at) VALUES(?,?,'items','file','file','text/plain',4,?,'2099-01-01')",
      )
        .bind(
          `draft-${tenantScope}`,
          tenantScope,
          `test-cascade/${tenantScope}/file`,
        )
        .run();
      await env.DOCUMENTS.put(`test-cascade/${tenantScope}/file`, "data");
      await env.DB.prepare(
        "INSERT INTO access_revisions(scope,revision) VALUES(?,1) ON CONFLICT(scope) DO NOTHING",
      )
        .bind(tenantScope)
        .run();
    }
    // A restrictive FK is one of the reasons ordinary deletion cannot proceed.
    await env.DB.prepare(
      "INSERT INTO tenant_whatsapp_connections(id,tenant_id,created_by_principal_id,nango_connection_id,nango_integration_id,status,created_at,updated_at) VALUES(?,?,?,'connection','integration','connected','now','now')",
    )
      .bind(`connection-${id}`, id, `principal-${id}`)
      .run();
    const app = createCascadeApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
    expect(
      (
        await app.request(`https://api.test/v1/tenants/${id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
    const response = await app.request(cascadeUrl(id), { method: "DELETE" });
    expect(response.status, await response.clone().text()).toBe(204);
    for (const table of [
      "studio_objects",
      "studio_records",
      "crm_sync_changes",
      "studio_file_drafts",
    ]) {
      expect(
        await env.DB.prepare(`SELECT 1 FROM ${table} WHERE tenant_id=?`)
          .bind(scope)
          .first(),
      ).toBeNull();
    }
    expect(
      await env.DB.prepare(
        "SELECT 1 FROM identity_tenant_membership WHERE tenant_id=?",
      )
        .bind(id)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT 1 FROM tenant_whatsapp_connections WHERE tenant_id=?",
      )
        .bind(id)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 FROM access_revisions WHERE scope=?")
        .bind(scope)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 FROM tenants WHERE id=?").bind(id).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 FROM identity_principal WHERE id=?")
        .bind(`principal-${id}`)
        .first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 FROM studio_records WHERE tenant_id=?")
        .bind(otherScope)
        .first(),
    ).not.toBeNull();
    expect(await env.DOCUMENTS.get(`test-cascade/${scope}/file`)).toBeNull();
    expect(
      await env.DOCUMENTS.get(`test-cascade/${otherScope}/file`),
    ).not.toBeNull();
  });

  it("keeps the core data retryable when external cleanup fails", async () => {
    const id = await tenant();
    const app = createCascadeApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
      saviaRequestService: {
        fetch: async () => new Response("Unavailable", { status: 503 }),
      },
    });
    const response = await app.request(cascadeUrl(id), { method: "DELETE" });
    expect(response.status).toBe(503);
    expect(
      await env.DB.prepare("SELECT 1 FROM tenants WHERE id=?").bind(id).first(),
    ).not.toBeNull();
  });
});

describe("tenant purge authorization and storage", () => {
  it("denies tenant administrators the cascade option", async () => {
    const id = await tenant();
    const app = createCascadeApp({
      auth: agencyAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
    const response = await app.request(
      `https://api.test/v1/tenants/${id}?cascade=true&confirmation=Purge%20agency`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(403);
    expect(
      await env.DB.prepare("SELECT 1 FROM tenants WHERE id=?").bind(id).first(),
    ).not.toBeNull();
  });

  it("deletes tenant Companion audio and notes, preserving personal and other tenant recordings", async () => {
    const id = await tenant();
    const base = `companion/samples/test-${id}/`;
    await env.DOCUMENTS.put(`${base}owned.ogg`, "audio", {
      customMetadata: { tenantId: String(id) },
    });
    await env.DOCUMENTS.put(`${base}owned.notes.json`, "{}");
    await env.DOCUMENTS.put(`${base}personal.ogg`, "personal");
    await env.DOCUMENTS.put(`${base}other.ogg`, "other", {
      customMetadata: { tenantId: String(id + 1) },
    });
    const app = createCascadeApp({
      auth: platformAdministratorAuthenticator(),
      documents: env.DOCUMENTS,
    });
    const response = await app.request(
      `https://api.test/v1/tenants/${id}?cascade=true&confirmation=Purge%20agency`,
      { method: "DELETE" },
    );
    expect(response.status, await response.clone().text()).toBe(204);
    expect(await env.DOCUMENTS.get(`${base}owned.ogg`)).toBeNull();
    expect(await env.DOCUMENTS.get(`${base}owned.notes.json`)).toBeNull();
    expect(await env.DOCUMENTS.get(`${base}personal.ogg`)).not.toBeNull();
    expect(await env.DOCUMENTS.get(`${base}other.ogg`)).not.toBeNull();
  });
});

it("rejects a cascade when the tenant name changes during external cleanup", async () => {
  const id = await tenant();
  const storageKey = `renamed-tenant/${id}/file`;
  await env.DB.prepare(
    "INSERT INTO studio_file_drafts(id,tenant_id,object_name,field_name,name,mime,size,storage_key,expires_at) VALUES(?,?,'items','file','file','text/plain',4,?,'2099-01-01')",
  )
    .bind(`rename-draft-${id}`, `tenant:${id}`, storageKey)
    .run();
  await env.DOCUMENTS.put(storageKey, "data");
  const app = createCascadeApp({
    auth: platformAdministratorAuthenticator(),
    documents: env.DOCUMENTS,
    saviaRequestService: {
      fetch: async () => {
        await env.DB.prepare(
          "UPDATE tenants SET name='Renamed tenant' WHERE id=?",
        )
          .bind(id)
          .run();
        return Response.json({ purged: {} });
      },
    },
  });
  const response = await app.request(
    `https://api.test/v1/tenants/${id}?cascade=true&confirmation=Purge%20agency`,
    { method: "DELETE" },
  );
  expect(response.status).toBe(409);
  expect(await env.DOCUMENTS.get(storageKey)).not.toBeNull();
  expect(
    await env.DB.prepare("SELECT name FROM tenants WHERE id=?")
      .bind(id)
      .first("name"),
  ).toBe("Renamed tenant");
});

it.each(["documents", "saviaRequestService"] as const)(
  "refuses complete deletion when %s is unavailable",
  async (binding) => {
    const id = await tenant();
    const app = createCascadeApp({ [binding]: undefined });
    const response = await app.request(
      `https://api.test/v1/tenants/${id}?cascade=true&confirmation=Purge%20agency`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(503);
    expect(
      await env.DB.prepare("SELECT is_active FROM tenants WHERE id=?")
        .bind(id)
        .first("is_active"),
    ).toBe(1);
  },
);

it("preserves storage bytes also referenced by another tenant", async () => {
  const id = await tenant(),
    other = await tenant();
  const principal = `office-owner-${id}`;
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,'Owner',1,'now','now')",
  )
    .bind(principal, "test", principal, `${principal}@test.example`)
    .run();
  const sharedKey = `office/shared-${id}`,
    revisionKey = `office/revision-${id}`;
  for (const ownerTenant of [id, other]) {
    await env.DB.prepare(
      "INSERT INTO office_documents(id,tenant_id,owner_id,name,mime,size,version,storage_key,created_at,updated_at) VALUES(?,?,?,'Shared','text/plain',4,1,?,'now','now')",
    )
      .bind(`office-${ownerTenant}`, ownerTenant, principal, sharedKey)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO office_document_revisions(document_id,version,storage_key,size,created_at) VALUES(?,1,?,4,'now')",
  )
    .bind(`office-${id}`, revisionKey)
    .run();
  await env.DOCUMENTS.put(sharedKey, "data");
  await env.DOCUMENTS.put(revisionKey, "old");
  const app = createCascadeApp();
  const response = await app.request(
    `https://api.test/v1/tenants/${id}?cascade=true&confirmation=Purge%20agency`,
    { method: "DELETE" },
  );
  expect(response.status, await response.clone().text()).toBe(204);
  expect(
    await env.DB.prepare("SELECT 1 FROM office_documents WHERE tenant_id=?")
      .bind(id)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT 1 FROM office_document_revisions WHERE document_id=?",
    )
      .bind(`office-${id}`)
      .first(),
  ).toBeNull();
  expect(await env.DOCUMENTS.get(revisionKey)).toBeNull();
  expect(await env.DOCUMENTS.get(sharedKey)).not.toBeNull();
  expect(
    await env.DB.prepare("SELECT 1 FROM office_documents WHERE tenant_id=?")
      .bind(other)
      .first(),
  ).not.toBeNull();
});
