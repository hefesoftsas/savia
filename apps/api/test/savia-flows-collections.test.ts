import { env } from "cloudflare:workers";
import { SignJWT, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./test-app";
import { agencyAdministratorAuthenticator } from "./auth-fixtures";
import { dispatchSaviaCollectionEvents } from "../src/savia-flows/event-dispatch";
import { WorkflowRepository } from "@savia/flows-native/repository";
import { processWorkflows } from "@savia/flows-native/runtime";

const secret = "savia-native-collections-test-secret-at-least-32-bytes";
const principal = "native-collections-user";
const tenant = "tenant:101";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(101,'native-collections','Native collections','commercial',1,'2026-10-12','2026-10-12')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,'test',?,'native@savia.test','Native test',1,'2026-10-12','2026-10-12')",
  )
    .bind(principal, principal)
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('native-membership',?,101,'tenant_admin',1,'2026-10-12','2026-10-12')",
  )
    .bind(principal)
    .run();
  for (const name of ["native_items", "native_other"])
    await env.DB.prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
    )
      .bind(
        tenant,
        name,
        name,
        JSON.stringify({
          fields: {
            title: { type: "Textbox", label: "Title", required: true },
            status: { type: "Textbox", label: "Status" },
          },
          fieldOrder: ["title", "status"],
        }),
      )
      .run();
});

async function call(
  body: Record<string, unknown>,
  identity: Record<string, unknown> = {},
  signedBody = body,
) {
  const raw = JSON.stringify(body);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(signedBody)),
  );
  const digest = [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const token = await new SignJWT({
    tenant,
    bodyDigest: digest,
    workflowId: "native-workflow",
    executionId: "native-run",
    nodeId: "native-node",
    ...identity,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(principal)
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
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: raw,
    },
    env,
  );
}

describe("native Savia collection host", () => {
  it("requires the dedicated short-lived local drain authority", async () => {
    const app = createTestApp({
      auth: agencyAdministratorAuthenticator(),
      saviaFlows: {
        bridgeSecret: secret,
        service: { fetch: () => Response.json({ accepted: 0 }) },
      },
    });
    const drain = (token = "") =>
      app.request(
        "/api/public/savia-flows/drain-events",
        { method: "POST", headers: { authorization: "Bearer " + token } },
        env,
      );
    const token = (audience: string, lifetime = "10s") =>
      new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("savia-flows")
        .setSubject("savia-local-outbox")
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(lifetime)
        .sign(new TextEncoder().encode(secret));
    expect((await drain()).status).toBe(401);
    expect(
      (await drain(await token("savia-flows-collections-host"))).status,
    ).toBe(401);
    expect(
      (await drain(await token("savia-flows-outbox-drain", "60s"))).status,
    ).toBe(401);
    const response = await drain(await token("savia-flows-outbox-drain"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, claimed: 0 });
  });
  it("keeps events pending while Flows is unavailable, then retries with a signed body", async () => {
    const response = await call(
      {
        action: "create",
        collection: "native_items",
        data: { title: "Outbox dispatch" },
      },
      { executionId: "dispatch-run" },
    );
    expect(response.status).toBe(200);
    const created = (await response.json()) as any;
    const event = await env.DB.prepare(
      "SELECT id FROM savia_flows_collection_event_outbox WHERE tenant_id=? AND record_id=?",
    )
      .bind(tenant, created.data.id)
      .first<{ id: string }>();
    expect(event?.id).toBeTruthy();
    const now = Date.now() + 100;
    const failed = await dispatchSaviaCollectionEvents(
      env.DB,
      {
        bridgeSecret: secret,
        service: { fetch: () => new Response("Unavailable", { status: 503 }) },
      },
      now,
    );
    expect(failed.failed).toBeGreaterThan(0);
    const pending = await env.DB.prepare(
      "SELECT status,last_error FROM savia_flows_collection_event_outbox WHERE id=?",
    )
      .bind(event!.id)
      .first<any>();
    expect(pending.status).toBe("pending");
    expect(pending.last_error).toBeTruthy();
    const delivered = await dispatchSaviaCollectionEvents(
      env.DB,
      {
        bridgeSecret: secret,
        service: {
          fetch: async (request) => {
            const { payload } = await jwtVerify(
              request.headers.get("x-savia-flows-event")!,
              new TextEncoder().encode(secret),
              { issuer: "savia", audience: "savia-flows-collection-events" },
            );
            expect(payload.tenant).toBe(tenant);
            const body = (await request.json()) as any;
            expect(payload.eventId).toBe(body.id);
            expect(body.after).toBeNull();
            expect(body.before).toBeNull();
            return Response.json({ accepted: 1 });
          },
        },
      },
      now + 2000,
    );
    expect(delivered.delivered).toBe(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM savia_flows_collection_event_outbox WHERE id=?",
        )
          .bind(event!.id)
          .first<any>()
      ).status,
    ).toBe("delivered");
    expect(
      (
        await dispatchSaviaCollectionEvents(
          env.DB,
          {
            bridgeSecret: secret,
            service: {
              fetch: () => {
                throw new Error("Already delivered event retried");
              },
            },
          },
          now + 4000,
        )
      ).claimed,
    ).toBe(0);
  });
  it("lists real local collection schemas from the current principal", async () => {
    const response = await call({ action: "catalog" });
    expect(response.status).toBe(200);
    const { collections } = (await response.json()) as any;
    expect(collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "native_items",
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "title", type: "Textbox" }),
          ]),
        }),
      ]),
    );
  });

  it("rejects a body that does not match its signed digest and foreign tenants", async () => {
    expect(
      (await call({ action: "catalog" }, {}, { action: "read" })).status,
    ).toBe(401);
    expect(
      (await call({ action: "catalog" }, { tenant: "tenant:202" })).status,
    ).toBe(403);
  });

  it("respects separate list and read capabilities, including event authorization", async () => {
    const created = await call(
      {
        action: "create",
        collection: "native_other",
        data: { title: "Capability test" },
      },
      { executionId: "capability-create" },
    );
    const { data } = (await created.json()) as any;
    const event = await env.DB.prepare(
      "SELECT id FROM savia_flows_collection_event_outbox WHERE record_id=?",
    )
      .bind(data.id)
      .first<{ id: string }>();
    const original = await env.DB.prepare(
      "SELECT config FROM studio_objects WHERE tenant_id=? AND name='native_other'",
    )
      .bind(tenant)
      .first<{ config: string }>();
    const config = JSON.parse(original!.config);
    const capabilities = {
      list: false,
      read: true,
      create: true,
      update: true,
      delete: true,
      schema: true,
      customFields: true,
    };
    const setCapabilities = async () =>
      env.DB.prepare(
        "UPDATE studio_objects SET config=? WHERE tenant_id=? AND name='native_other'",
      )
        .bind(JSON.stringify({ ...config, studio: { capabilities } }), tenant)
        .run();
    try {
      await setCapabilities();
      expect(
        (await call({ action: "list", collection: "native_other" })).status,
      ).toBe(403);
      expect(
        (
          await call({
            action: "read",
            collection: "native_other",
            recordId: data.id,
          })
        ).status,
      ).toBe(200);
      capabilities.read = false;
      await setCapabilities();
      expect(
        (await call({ action: "authorize-event", eventId: event!.id })).status,
      ).toBe(403);
    } finally {
      await env.DB.prepare(
        "UPDATE studio_objects SET config=? WHERE tenant_id=? AND name='native_other'",
      )
        .bind(original!.config, tenant)
        .run();
    }
  });

  it("persists create receipts atomically and rejects reusing the node for another write", async () => {
    const body = {
      action: "create",
      collection: "native_items",
      data: { title: "Created by a flow", status: "new" },
    };
    const first = await call(body, { executionId: "create-run" });
    expect(first.status).toBe(200);
    const created = (await first.json()) as any;
    expect(created.data._version).toBe(1);
    expect(created.data.created_by).toBe(principal);
    const repeated = await call(body, { executionId: "create-run" });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(created);
    expect(
      (
        await call(
          { ...body, data: { title: "Different payload" } },
          { executionId: "create-run" },
        )
      ).status,
    ).toBe(409);
    const count = await env.DB.prepare(
      "SELECT count(*) count FROM studio_records WHERE tenant_id=? AND object_name='native_items' AND json_extract(data,'$.title')='Created by a flow'",
    )
      .bind(tenant)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("requires execution identity and current membership even for a replay", async () => {
    expect(
      (
        await call(
          {
            action: "create",
            collection: "native_items",
            data: { title: "Missing identity" },
          },
          { executionId: null },
        )
      ).status,
    ).toBe(422);
    const body = {
      action: "create",
      collection: "native_items",
      data: { title: "Revocation receipt" },
    };
    expect((await call(body, { executionId: "revoked-run" })).status).toBe(200);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE id='native-membership'",
    ).run();
    try {
      expect((await call(body, { executionId: "revoked-run" })).status).toBe(
        403,
      );
    } finally {
      await env.DB.prepare(
        "UPDATE identity_tenant_membership SET is_active=1 WHERE id='native-membership'",
      ).run();
    }
  });

  it("checks versions, replays updates once and performs recoverable deletion", async () => {
    const created = (await (
      await call(
        {
          action: "create",
          collection: "native_other",
          data: { title: "Version test" },
        },
        { executionId: "version-create" },
      )
    ).json()) as any;
    const id = created.data.id;
    expect(
      (
        await call({
          action: "update",
          collection: "native_other",
          recordId: id,
          data: { status: "ready" },
        })
      ).status,
    ).toBe(428);
    const update = {
      action: "update",
      collection: "native_other",
      recordId: id,
      version: 1,
      data: { status: "ready" },
    };
    const changed = await call(update, { executionId: "update-run" });
    expect(changed.status).toBe(200);
    const result = await changed.json();
    expect(
      await (await call(update, { executionId: "update-run" })).json(),
    ).toEqual(result);
    expect((await call(update, { executionId: "stale-run" })).status).toBe(409);
    const deletion = {
      action: "delete",
      collection: "native_other",
      recordId: id,
      version: 2,
    };
    expect((await call(deletion, { executionId: "delete-run" })).status).toBe(
      200,
    );
    expect((await call(deletion, { executionId: "delete-run" })).status).toBe(
      200,
    );
    const row = await env.DB.prepare(
      "SELECT version,deleted_at FROM studio_records WHERE tenant_id=? AND id=?",
    )
      .bind(tenant, id)
      .first<any>();
    expect(row.version).toBe(3);
    expect(row.deleted_at).toBeTruthy();
  });

  it("preserves ancestry and recursion depth across graph and transactional writes", async () => {
    const repository = new WorkflowRepository(env.DB, tenant);
    const flow = await repository.create(
      {
        name: "Mixed mode chain",
        definition: {
          trigger: { type: "created", collection: "native_items" },
          nodes: [
            {
              id: "copy",
              type: "create",
              collection: "native_other",
              values: { title: { ref: "trigger.title" } },
            },
          ],
        },
      },
      principal,
    );
    await repository.publish(flow.id, flow.revision, principal);
    try {
      const response = await call(
        {
          action: "create",
          collection: "native_items",
          data: { title: "Mixed ancestry" },
          cause: {
            rootEventId: "root-event",
            workflowIds: ["graph-parent"],
            depth: 2,
          },
        },
        { workflowId: "graph-parent", executionId: "mixed-cause-run" },
      );
      expect(response.status).toBe(200);
      const run = (await repository.executions(flow.id))[0];
      expect(run.depth).toBe(3);
      await processWorkflows(env.DB, async () => true);
      const copied = await env.DB.prepare(
        "SELECT cause_id FROM savia_flows_collection_event_outbox WHERE tenant_id=? AND collection_name='native_other' AND actor_id=? AND json_extract(after_snapshot,'$.title')='Mixed ancestry' LIMIT 1",
      )
        .bind(tenant, principal)
        .first<{ cause_id: string }>();
      expect(JSON.parse(copied!.cause_id)).toEqual({
        rootEventId: "root-event",
        workflowIds: ["graph-parent", `native:${flow.id}`],
        depth: 4,
      });
      const before = (await repository.executions(flow.id)).length;
      expect(
        (
          await call(
            {
              action: "create",
              collection: "native_items",
              data: { title: "Chain limit" },
              cause: {
                rootEventId: "root-limit",
                workflowIds: ["graph-limit"],
                depth: 4,
              },
            },
            { workflowId: "graph-limit", executionId: "mixed-limit-run" },
          )
        ).status,
      ).toBe(200);
      expect((await repository.executions(flow.id)).length).toBe(before);
      expect(
        (
          await env.DB.prepare(
            "SELECT count(*) AS count FROM workflow_write_context",
          ).first<any>()
        ).count,
      ).toBe(0);
    } finally {
      await repository.setEnabled(flow.id, false);
    }
  });
});
