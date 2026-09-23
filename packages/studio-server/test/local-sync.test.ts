import { beforeAll, afterAll, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { makeConfig } from "@savia/studio-shared/metadata";
import { createStudioApp } from "../src/index";
let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;
const app = createStudioApp("sync-test", { principalId: "user-1" });
const request = (path: string, body?: unknown) =>
  app.request(
    "http://localhost/api" + path,
    {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    platform.env,
  );
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync("migrations/" + name, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await platform.env.DB.prepare(sql).run();
  await request("/bootstrap", {});
  const res = await request("/objects", {
    name: "initial",
    label: "Initial",
    config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
  });
  expect(res.status, await res.text()).toBe(201);
  await request("/records/initial", { name: "Seed" });
});
afterAll(async () => platform?.dispose());
it("publishes authenticated scoped manifest and durable paginated changes", async () => {
  const manifest = await request("/local-sync/manifest");
  expect(manifest.status).toBe(200);
  const m: any = await manifest.json();
  expect(m.principalId).toBe("user-1");
  const collection = m.collections.find(
    (c: any) => c.capability === "read-write",
  ).name;
  const first: any = await (
    await request("/local-sync/pull/" + collection + "?limit=1")
  ).json();
  expect(first.documents).toHaveLength(1);
  expect(first.cursor).toBeTypeOf("string");
  const foreign = createStudioApp("other", { principalId: "user-1" });
  const response = await foreign.request(
    "http://localhost/api/local-sync/pull/" +
      collection +
      "?cursor=" +
      encodeURIComponent(first.cursor),
    {},
    platform.env,
  );
  expect(response.status).not.toBe(200);
});
it("replays lost acknowledgements atomically for create update delete and reports conflicts", async () => {
  await request("/objects", {
    name: "sync_item",
    label: "Items",
    config: makeConfig({
      name: { type: "Textbox", label: "Name", required: true },
    }),
  });
  const push = (body: unknown) => request("/local-sync/push/sync_item", body);
  const create = {
    mutationId: "create-1",
    action: "create",
    id: "stable-id",
    data: { name: "First" },
  };
  const a = await push(create);
  expect(a.status).toBe(200);
  const created: any = await a.json();
  expect(created.data.id).toBe("stable-id");
  expect(await (await push(create)).json()).toEqual(created);
  const update = {
    mutationId: "update-1",
    action: "update",
    id: "stable-id",
    baseVersion: 1,
    data: { name: "Second" },
  };
  const updated: any = await (await push(update)).json();
  expect(updated.data._version).toBe(2);
  expect(await (await push(update)).json()).toEqual(updated);
  const conflict = await push({ ...update, mutationId: "update-2" });
  expect(conflict.status).toBe(409);
  expect(((await conflict.json()) as any).data.name).toBe("Second");
  const deletion = {
    mutationId: "delete-1",
    action: "delete",
    id: "stable-id",
    baseVersion: 2,
  };
  const deleted: any = await (await push(deletion)).json();
  expect(deleted.data.deleted_at).toBeTruthy();
  expect(await (await push(deletion)).json()).toEqual(deleted);
  const pull: any = await (await request("/local-sync/pull/sync_item")).json();
  expect(pull.documents.at(-1).deleted_at).toBeTruthy();
  expect(pull.documents.at(-1)._version).toBe(3);
});
it("keeps bootstrap gap-free across concurrent writes and emits hard-delete tombstones", async () => {
  const db = platform.env.DB;
  for (const id of ["a", "b", "c"])
    await db
      .prepare(
        "INSERT INTO studio_records(tenant_id,object_name,id,data) VALUES ('sync-test','initial',?,?)",
      )
      .bind(id, JSON.stringify({ name: id }))
      .run();
  let page: any = await (
    await request("/local-sync/pull/initial?limit=1")
  ).json();
  let documents = [...page.documents];
  await db
    .prepare(
      "UPDATE studio_records SET data='{}',version=version+1 WHERE tenant_id='sync-test' AND id='a'",
    )
    .run();
  await db
    .prepare(
      "DELETE FROM studio_records WHERE tenant_id='sync-test' AND id='b'",
    )
    .run();
  while (page.hasMore) {
    page = await (
      await request(
        "/local-sync/pull/initial?limit=1&cursor=" +
          encodeURIComponent(page.cursor),
      )
    ).json();
    documents.push(...page.documents);
  }
  expect(documents.filter((d: any) => d.id === "a").at(-1)._version).toBe(2);
  expect(
    documents.filter((d: any) => d.id === "b").at(-1).deleted_at,
  ).toBeTruthy();
  await db
    .prepare(
      "UPDATE studio_records SET data='{}',version=version+1 WHERE tenant_id='sync-test' AND id='c'",
    )
    .run();
  const delta: any = await (
    await request(
      "/local-sync/pull/initial?cursor=" + encodeURIComponent(page.cursor),
    )
  ).json();
  expect(delta.documents).toHaveLength(1);
  expect(delta.documents[0].id).toBe("c");
  expect((await request("/local-sync/pull/initial?cursor=broken")).status).toBe(
    422,
  );
});
it("rejects mutation ID reuse, converges concurrent retries, and isolates principals", async () => {
  const body = {
    mutationId: "concurrent",
    action: "create",
    id: "race-record",
    data: { name: "Race" },
  };
  const responses = await Promise.all([
    request("/local-sync/push/sync_item", body),
    request("/local-sync/push/sync_item", body),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0].json()).toEqual(await responses[1].json());
  expect(
    (
      await request("/local-sync/push/sync_item", {
        ...body,
        data: { name: "Wrong" },
      })
    ).status,
  ).toBe(409);
  const other = createStudioApp("sync-test", { principalId: "user-2" });
  const response = await other.request(
    "http://localhost/api/local-sync/push/sync_item",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, id: "other-principal" }),
    },
    platform.env,
  );
  expect(response.status).toBe(200);
});
it("does not expose external source shadows", async () => {
  await platform.env.DB.prepare(
    "UPDATE studio_objects SET config=json_set(config,'$.studio.business',json('{}')) WHERE tenant_id='sync-test' AND name='initial'",
  ).run();
  const manifest: any = await (await request("/local-sync/manifest")).json();
  expect(
    manifest.collections.find((c: any) => c.name === "initial").capability,
  ).toBe("remote");
  expect((await request("/local-sync/pull/initial")).status).toBe(422);
  expect(
    (
      await request("/local-sync/push/initial", {
        mutationId: "remote",
        action: "create",
        id: "remote-id",
        data: {},
      })
    ).status,
  ).toBe(422);
});

it("fails closed for external metadata even before its binding is available", async () => {
  await platform.env.DB.prepare(
    "UPDATE studio_objects SET config=json_remove(json_set(config,'$.studio.collection',json('{\"kind\":\"postgres\"}')),'$.studio.business') WHERE tenant_id='sync-test' AND name='initial'",
  ).run();
  const manifest: any = await (await request("/local-sync/manifest")).json();
  expect(
    manifest.collections.find((item: any) => item.name === "initial")
      .capability,
  ).toBe("remote");
  expect((await request("/local-sync/pull/initial")).status).toBe(422);
});

it("compacts superseded changes without losing writes that move past a bootstrap cursor", async () => {
  const db = platform.env.DB;
  const created = await request("/local-sync/push/sync_item", {
    mutationId: "compact-create",
    action: "create",
    id: "compact",
    data: { name: "Before" },
  });
  expect(created.status).toBe(200);
  const before: any = await (
    await request("/local-sync/pull/sync_item?limit=1")
  ).json();
  await request("/local-sync/push/sync_item", {
    mutationId: "compact-update",
    action: "update",
    id: "compact",
    baseVersion: 1,
    data: { name: "After" },
  });
  const count = await db
    .prepare(
      "SELECT count(*) AS n FROM crm_sync_changes WHERE tenant_id='sync-test' AND object_name='sync_item' AND id='compact'",
    )
    .first<{ n: number }>();
  expect(count?.n).toBe(1);
  const rest: any = await (
    await request(
      "/local-sync/pull/sync_item?cursor=" + encodeURIComponent(before.cursor),
    )
  ).json();
  expect(rest.documents.find((d: any) => d.id === "compact").name).toBe(
    "After",
  );
});

it("captures recreation by bulk INSERT OR IGNORE after a hard delete", async () => {
  const db = platform.env.DB;
  await db
    .prepare(
      "INSERT INTO studio_records(tenant_id,object_name,id,data) VALUES ('sync-test','sync_item','bulk-recreated','{}')",
    )
    .run();
  await db
    .prepare(
      "DELETE FROM studio_records WHERE tenant_id='sync-test' AND id='bulk-recreated'",
    )
    .run();
  await db
    .prepare(
      "INSERT OR IGNORE INTO studio_records(tenant_id,object_name,id,data) VALUES ('sync-test','sync_item','bulk-recreated','{}')",
    )
    .run();
  const state = await db
    .prepare(
      "SELECT deleted_at FROM crm_sync_changes WHERE tenant_id='sync-test' AND id='bulk-recreated'",
    )
    .first<{ deleted_at: string | null }>();
  expect(state?.deleted_at).toBeNull();
});

it("runs the existing record automations for newly accepted mutations", async () => {
  const rule = await request("/automations", {
    name: "Sync welcome",
    object_name: "sync_item",
    config: {
      field: "name",
      value: "Automated",
      title: "Welcome {{name}}",
      dueDays: 0,
      owner: "Team",
    },
  });
  expect(rule.status).toBe(200);
  const body = {
    mutationId: "automation-create",
    action: "create",
    id: "automated-record",
    data: { name: "Automated" },
  };
  expect((await request("/local-sync/push/sync_item", body)).status).toBe(200);
  expect((await request("/local-sync/push/sync_item", body)).status).toBe(200);
  const tasks: any = await (
    await request("/tasks?record=automated-record")
  ).json();
  expect(tasks.data).toHaveLength(1);
});

it("resumes a committed mutation whose automation acknowledgement was interrupted", async () => {
  const db = platform.env.DB;
  await db
    .prepare(
      "DELETE FROM studio_tasks WHERE tenant_id='sync-test' AND record_id='automated-record'",
    )
    .run();
  await db
    .prepare(
      "DELETE FROM studio_automation_runs WHERE tenant_id='sync-test' AND record_id='automated-record'",
    )
    .run();
  await db
    .prepare(
      "UPDATE crm_sync_receipts SET effects_applied=0 WHERE tenant_id='sync-test' AND mutation_id='automation-create'",
    )
    .run();
  const response = await request("/local-sync/push/sync_item", {
    mutationId: "automation-create",
    action: "create",
    id: "automated-record",
    data: { name: "Automated" },
  });
  expect(response.status).toBe(200);
  const tasks: any = await (
    await request("/tasks?record=automated-record")
  ).json();
  expect(tasks.data).toHaveLength(1);
});

it("rejects every synchronization request bound to a different authenticated principal", async () => {
  for (const [path, method] of [
    ["/manifest", "GET"],
    ["/pull/sync_item", "GET"],
    ["/push/sync_item", "POST"],
  ]) {
    const response = await app.request(
      "http://localhost/api/local-sync" + path,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Savia-Sync-Principal": "other-principal",
        },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                mutationId: "wrong-principal",
                action: "create",
                id: "must-not-write",
                data: { name: "Forbidden" },
              }),
            }
          : {}),
      },
      platform.env,
    );
    expect(response.status).toBe(403);
  }
  expect(
    await platform.env.DB.prepare(
      "SELECT 1 FROM studio_records WHERE id='must-not-write'",
    ).first(),
  ).toBeNull();
});
