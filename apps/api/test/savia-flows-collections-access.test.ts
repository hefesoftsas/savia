import { env } from "cloudflare:workers";
import { SignJWT } from "jose";
import { beforeAll, expect, it } from "vitest";
import { historyDatabase } from "@savia/studio-server/record-history-storage";
import { bodyDigest } from "../src/savia-flows/protocol";
import { createAccessFixture } from "./access-control-fixtures";
import { agencyAdministratorAuthenticator } from "./auth-fixtures";
import { createTestApp } from "./test-app";
import {
  loadAccessPolicy,
  replaceAccessAssignments,
  saveAccessRole,
} from "../src/auth/access-repository";

const secret = "savia-native-collection-access-test-secret-at-least-32-bytes";
const tenant = "tenant:101";
const otherTenant = "tenant:102";
const principal = "acl-viewer";
const roleName = "native_flow_access";

let fixture: Awaited<ReturnType<typeof createAccessFixture>>;
let roleId: string;
let visibleRecordId: string;
let hiddenRecordId: string;

beforeAll(async () => {
  fixture = await createAccessFixture();
  const admin = await fixture.actor("agency_admin");
  const currentPolicy = await loadAccessPolicy(fixture.db, admin, tenant);
  const role = await saveAccessRole(fixture.db, admin, {
    scope: tenant,
    name: roleName,
    label: "Native collection access",
    description: "Scoped native workflow collection access",
    enabled: true,
    expectedRevision: currentPolicy.revision,
    grants: [
      {
        resource: "collection:acl_contacts",
        action: "read",
        predicate: {
          field: "commission",
          op: "lt",
          value: { literal: 150 },
        },
        fields: ["name"],
      },
      {
        resource: "collection:acl_contacts",
        action: "create",
        predicate: { all: true },
        fields: ["name", "commission"],
      },
      {
        resource: "collection:acl_contacts",
        action: "update",
        predicate: {
          field: "commission",
          op: "lt",
          value: { literal: 150 },
        },
        fields: ["commission"],
      },
    ],
  });
  roleId = role.id;
  await replaceAccessAssignments(fixture.db, admin, {
    scope: tenant,
    principalId: principal,
    roleIds: [role.id],
    expectedRevision: role.revision,
  });
  visibleRecordId = (await fixture.db
    .prepare(
      "SELECT id FROM studio_records WHERE tenant_id=? AND object_name='acl_contacts' AND json_extract(data,'$.commission')=101 LIMIT 1",
    )
    .bind(tenant)
    .first<{ id: string }>())!.id;
  hiddenRecordId = crypto.randomUUID();
  await fixture.db
    .prepare(
      "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at,created_by) VALUES(?,?,?,?,'2026-10-12','2026-10-12',?)",
    )
    .bind(
      hiddenRecordId,
      tenant,
      "acl_contacts",
      JSON.stringify({ name: "Hidden client", commission: 200 }),
      principal,
    )
    .run();
});

async function call(
  body: Record<string, unknown>,
  identity: {
    principalId?: string;
    tenant?: string;
    workflowId?: string | null;
    executionId?: string | null;
    nodeId?: string | null;
  } = {},
) {
  const raw = JSON.stringify(body);
  const token = await new SignJWT({
    tenant: identity.tenant ?? tenant,
    bodyDigest: await bodyDigest(raw),
    workflowId: identity.workflowId ?? "native-access-workflow",
    executionId: identity.executionId ?? crypto.randomUUID(),
    nodeId: identity.nodeId ?? "native-access-node",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.principalId ?? principal)
    .setIssuer("savia-flows")
    .setAudience("savia-flows-collections-host")
    .setIssuedAt()
    .setExpirationTime("10s")
    .sign(new TextEncoder().encode(secret));
  const app = createTestApp({
    auth: agencyAdministratorAuthenticator(),
    saviaFlows: { bridgeSecret: secret },
  });
  return app.request(
    "/api/public/savia-flows/collections",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: raw,
    },
    env,
  );
}

async function updateRecordForEvent(
  scope: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const db = historyDatabase(env.DB, scope, { kind: "user", id: principal });
  await db
    .prepare(
      "UPDATE studio_records SET data=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?",
    )
    .bind(JSON.stringify(patch), new Date().toISOString(), scope, id)
    .run();
  return env.DB.prepare(
    "SELECT id FROM savia_flows_collection_event_outbox WHERE tenant_id=? AND record_id=? AND operation='updated' ORDER BY occurred_at DESC LIMIT 1",
  )
    .bind(scope, id)
    .first<{ id: string }>();
}

it("lists and reads only rows and fields granted to the current custom role", async () => {
  const list = await call({ action: "list", collection: "acl_contacts" });
  expect(list.status, await list.clone().text()).toBe(200);
  const listed = (await list.json()) as any;
  expect(listed.total).toBe(1);
  expect(listed.data).toHaveLength(1);
  expect(listed.data[0]).toMatchObject({
    id: visibleRecordId,
    name: "Tenant 101",
  });
  expect(listed.data[0]).not.toHaveProperty("commission");

  const read = await call({
    action: "read",
    collection: "acl_contacts",
    recordId: visibleRecordId,
  });
  expect(read.status, await read.clone().text()).toBe(200);
  expect(((await read.json()) as any).data).not.toHaveProperty("commission");
  expect(
    (
      await call({
        action: "read",
        collection: "acl_contacts",
        recordId: hiddenRecordId,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call({
        action: "list",
        collection: "acl_contacts",
        filters: { commission: 101 },
      })
    ).status,
  ).toBe(403);
});

it("allows granted create/update fields while omitting fields without read grants", async () => {
  const createBody = {
    action: "create",
    collection: "acl_contacts",
    data: { name: "Native created", commission: 120 },
  };
  const create = await call(createBody, {
    executionId: "native-access-create",
  });
  expect(create.status, await create.clone().text()).toBe(200);
  const created = (await create.json()) as any;
  expect(created.data.name).toBe("Native created");
  expect(created.data).not.toHaveProperty("commission");
  expect(
    await env.DB.prepare(
      "SELECT json_extract(data,'$.commission') value FROM studio_records WHERE id=?",
    )
      .bind(created.data.id)
      .first(),
  ).toEqual({ value: 120 });

  expect(
    (
      await call(
        {
          action: "update",
          collection: "acl_contacts",
          recordId: visibleRecordId,
          version: 1,
          data: { name: "Not granted for update" },
        },
        { executionId: "native-access-denied-update" },
      )
    ).status,
  ).toBe(403);
  const update = await call(
    {
      action: "update",
      collection: "acl_contacts",
      recordId: visibleRecordId,
      version: 1,
      data: { commission: 111 },
    },
    { executionId: "native-access-update" },
  );
  expect(update.status, await update.clone().text()).toBe(200);
  expect(((await update.json()) as any).data).not.toHaveProperty("commission");
  expect(
    await env.DB.prepare(
      "SELECT json_extract(data,'$.commission') value FROM studio_records WHERE id=?",
    )
      .bind(visibleRecordId)
      .first(),
  ).toEqual({ value: 111 });
});

it("rechecks revoked grants before cached mutation receipts and prevents duplicate writes", async () => {
  const body = {
    action: "create",
    collection: "acl_contacts",
    data: { name: "Receipt revocation", commission: 130 },
  };
  const identity = { executionId: "native-revoked-receipt" };
  const first = await call(body, identity);
  expect(first.status, await first.clone().text()).toBe(200);
  const created = (await first.json()) as any;
  const admin = await fixture.actor("agency_admin");
  const policy = await loadAccessPolicy(fixture.db, admin, tenant);
  const grants = [
    {
      resource: "collection:acl_contacts" as const,
      action: "read" as const,
      predicate: {
        field: "commission",
        op: "lt" as const,
        value: { literal: 150 },
      },
      fields: ["name"],
    },
  ];
  await saveAccessRole(fixture.db, admin, {
    id: roleId,
    scope: tenant,
    name: roleName,
    label: "Native collection access",
    description: "Temporarily revoked",
    enabled: false,
    expectedRevision: policy.revision,
    grants,
  });
  try {
    const replay = await call(body, identity);
    expect(replay.status).toBe(403);
    expect(
      await env.DB.prepare(
        "SELECT count(*) value FROM studio_records WHERE tenant_id=? AND id=?",
      )
        .bind(tenant, created.data.id)
        .first(),
    ).toEqual({ value: 1 });
  } finally {
    const current = await loadAccessPolicy(fixture.db, admin, tenant);
    await saveAccessRole(fixture.db, admin, {
      id: roleId,
      scope: tenant,
      name: roleName,
      label: "Native collection access",
      description: "Scoped native workflow collection access",
      enabled: true,
      expectedRevision: current.revision,
      grants: [
        {
          resource: "collection:acl_contacts",
          action: "read",
          predicate: {
            field: "commission",
            op: "lt",
            value: { literal: 150 },
          },
          fields: ["name"],
        },
        {
          resource: "collection:acl_contacts",
          action: "create",
          predicate: { all: true },
          fields: ["name", "commission"],
        },
        {
          resource: "collection:acl_contacts",
          action: "update",
          predicate: {
            field: "commission",
            op: "lt",
            value: { literal: 150 },
          },
          fields: ["commission"],
        },
      ],
    });
  }
});

it("requires active principals, tenant memberships, and tenants for native calls", async () => {
  await env.DB.prepare("UPDATE identity_principal SET is_active=0 WHERE id=?")
    .bind(principal)
    .run();
  try {
    expect(
      (await call({ action: "list", collection: "acl_contacts" })).status,
    ).toBe(403);
  } finally {
    await env.DB.prepare("UPDATE identity_principal SET is_active=1 WHERE id=?")
      .bind(principal)
      .run();
  }

  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=? AND tenant_id=101",
  )
    .bind(principal)
    .run();
  try {
    expect(
      (await call({ action: "list", collection: "acl_contacts" })).status,
    ).toBe(403);
  } finally {
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id=? AND tenant_id=101",
    )
      .bind(principal)
      .run();
  }

  await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=101").run();
  try {
    expect(
      (await call({ action: "list", collection: "acl_contacts" })).status,
    ).toBe(403);
  } finally {
    await env.DB.prepare("UPDATE tenants SET is_active=1 WHERE id=101").run();
  }
});

it("projects event snapshots only when both snapshots are readable and enforces event tenant isolation", async () => {
  const readable = await updateRecordForEvent(tenant, visibleRecordId, {
    name: "Event readable",
    commission: 111,
  });
  expect(readable?.id).toBeTruthy();
  const authorized = await call({
    action: "authorize-event",
    eventId: readable!.id,
  });
  expect(authorized.status, await authorized.clone().text()).toBe(200);
  const body = (await authorized.json()) as any;
  expect(body.authorized).toBe(true);
  expect(body.event.before.name).toBe("Tenant 101");
  expect(body.event.after.name).toBe("Event readable");
  expect(body.event.before).not.toHaveProperty("commission");
  expect(body.event.after).not.toHaveProperty("commission");

  const restricted = await updateRecordForEvent(tenant, visibleRecordId, {
    name: "Event hidden after",
    commission: 200,
  });
  expect(restricted?.id).toBeTruthy();
  expect(
    (await call({ action: "authorize-event", eventId: restricted!.id })).status,
  ).toBe(403);

  const otherRecord = (await env.DB.prepare(
    "SELECT id FROM studio_records WHERE tenant_id=? AND object_name='acl_contacts' LIMIT 1",
  )
    .bind(otherTenant)
    .first<{ id: string }>())!.id;
  const foreignEvent = await updateRecordForEvent(otherTenant, otherRecord, {
    name: "Foreign tenant event",
    commission: 102,
  });
  expect(foreignEvent?.id).toBeTruthy();
  expect(
    (await call({ action: "authorize-event", eventId: foreignEvent!.id }))
      .status,
  ).toBe(403);
});
