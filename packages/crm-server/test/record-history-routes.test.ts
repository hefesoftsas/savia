import { beforeAll, afterAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { makeConfig } from "@savia/crm-shared/metadata";
import type {
  AccessPolicy,
  AccessPredicate,
} from "@savia/crm-shared/access-control";
import { accessDatabase } from "../src/access-authorization";
import { createCrmApp } from "../src/index";
let platform: Awaited<
  ReturnType<typeof getPlatformProxy<{ DB: D1Database; POC_LOCAL: string }>>
>;
const app = createCrmApp("history", { principalId: "alice" });
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  selected = app,
  db = platform.env.DB,
) =>
  selected.request(
    "http://localhost/api" + path,
    {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { ...platform.env, DB: db },
  );
let count = 0;
async function fixture() {
  const name = `history_${++count}`;
  const response = await request("/objects", "POST", {
    name,
    label: "History",
    config: makeConfig({
      name: { type: "Textbox", label: "Name" },
      secret: { type: "Textbox", label: "Secret" },
      status: { type: "Textbox", label: "Status" },
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return name;
}
async function enable(name: string) {
  const response = await request(`/record-history-settings/${name}`, "PUT", {
    enabled: true,
    fields: ["name", "secret"],
    retentionDays: 90,
    expectedVersion: 1,
  });
  expect(response.status, await response.clone().text()).toBe(200);
}
async function create(name: string) {
  const response = await request(`/records/${name}`, "POST", {
    name: "First",
    secret: "hidden",
    status: "open",
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as any).data;
}
function policy(
  name: string,
  predicate: AccessPredicate = { all: true },
  fields = ["name"],
): AccessPolicy {
  return {
    principalId: "alice",
    scope: "tenant:101",
    revision: 1,
    grants: [
      {
        id: "grant",
        roleId: "role",
        resource: `collection:${name}`,
        action: "read",
        predicate,
        fields,
      },
    ],
  };
}
function scoped(name: string, p: AccessPolicy) {
  return (path: string) =>
    request(
      path,
      "GET",
      undefined,
      createCrmApp("history", { principalId: "alice", accessPolicy: p }),
      accessDatabase(platform.env.DB, p),
    );
}
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of readFileSync("migrations/" + file, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((s) => s.trim()))
      await platform.env.DB.prepare(sql).run();
  // Standalone policy guard fixture mirrors the API's current revision table.
  await platform.env.DB.exec(
    "CREATE TABLE access_revisions(scope TEXT PRIMARY KEY,revision INTEGER); INSERT INTO access_revisions VALUES ('tenant:101',1)",
  );
});
afterAll(async () => platform?.dispose());
it("configures eligible history fields with optimistic object version checks", async () => {
  const name = await fixture();
  const initial = await request(`/record-history-settings/${name}`);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toMatchObject({
    version: 1,
    data: { enabled: false, fields: [], retentionDays: 90 },
  });
  await enable(name);
  expect(
    (
      await request(`/record-history-settings/${name}`, "PUT", {
        enabled: false,
        fields: [],
        retentionDays: 90,
        expectedVersion: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(`/record-history-settings/${name}`, "PUT", {
        enabled: true,
        fields: ["missing"],
        retentionDays: 90,
        expectedVersion: 2,
      })
    ).status,
  ).toBe(422);
});
it("paginates summaries without values and loads one selected version", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  expect(
    (
      await request(`/records/${name}/${record.id}`, "PATCH", {
        name: "Second",
        _version: 1,
      })
    ).status,
  ).toBe(200);
  const path = `/record-history/${name}/${record.id}`;
  const response = await request(path + "?limit=1");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const page = (await response.json()) as any;
  expect(page.data).toHaveLength(1);
  expect(page.data[0]).toMatchObject({
    version: 2,
    actor: { id: "alice", kind: "user" },
    fields: ["name"],
  });
  expect(JSON.stringify(page)).not.toContain("Second");
  const detail = (await (await request(path + "/2")).json()) as any;
  expect(detail.data.changes).toEqual({
    name: { before: "First", after: "Second" },
  });
  const next = (await (
    await request(path + "?cursor=" + encodeURIComponent(page.nextCursor))
  ).json()) as any;
  expect(next.data.map((e: any) => e.version)).toEqual([1]);
  expect((await request(path + "?cursor=bad")).status).toBe(422);
  expect(
    (
      await request(
        path,
        "GET",
        undefined,
        createCrmApp("other", { principalId: "bob" }),
      )
    ).status,
  ).toBe(404);
});
it("projects historic fields and denies grants dependent on mutable values", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  const path = `/record-history/${name}/${record.id}`;
  const read = scoped(name, policy(name));
  const detail = await read(path + "/1");
  expect(detail.status).toBe(200);
  expect(((await detail.json()) as any).data.changes).toEqual({
    name: { after: "First" },
  });
  const conditional = scoped(
    name,
    policy(name, { field: "status", op: "eq", value: { literal: "open" } }, [
      "name",
      "secret",
    ]),
  );
  expect((await conditional(path)).status).toBe(403);
  const own = scoped(
    name,
    policy(name, {
      field: "$createdBy",
      op: "eq",
      value: { variable: "principalId" },
    }),
  );
  expect((await own(path)).status).toBe(200);
  const denied = scoped(
    name,
    policy(name, {
      field: "$createdBy",
      op: "eq",
      value: { literal: "other" },
    }),
  );
  expect((await denied(path)).status).toBe(403);
  expect((await read(`/record-history-settings/${name}`)).status).toBe(403);
});
it("immediately hides expired events and requires restore permission for trash", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  const path = `/record-history/${name}/${record.id}`;
  await platform.env.DB.prepare(
    "UPDATE crm_record_history SET expires_at='2000-01-01T00:00:00.000Z' WHERE object_name=?",
  )
    .bind(name)
    .run();
  expect(((await (await request(path)).json()) as any).data).toEqual([]);
  expect((await request(path + "/1")).status).toBe(404);
  expect(
    (await request(`/records/${name}/${record.id}?version=1`, "DELETE")).status,
  ).toBe(200);
  expect((await scoped(name, policy(name))(path)).status).toBe(403);
});
it("redacts retained values after a field becomes unreadable in current metadata", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  await platform.env.DB.prepare(
    "UPDATE crm_objects SET config=json_set(config,'$.fields.secret.readable',json('false'),'$.studio.history.fields',json('[\"name\"]')) WHERE tenant_id='history' AND name=?",
  )
    .bind(name)
    .run();
  const result = await request(`/record-history/${name}/${record.id}/1`);
  expect(result.status).toBe(200);
  expect(((await result.json()) as any).data.changes).toEqual({
    name: { after: "First" },
  });
});

it("starts without backfill and preserves original expiry when tracking is disabled", async () => {
  const name = await fixture();
  const record = await create(name);
  const path = `/record-history/${name}/${record.id}`;
  expect(((await (await request(path)).json()) as any).data).toEqual([]);
  await enable(name);
  expect(
    (
      await request(`/records/${name}/${record.id}`, "PATCH", {
        name: "Tracked",
        _version: 1,
      })
    ).status,
  ).toBe(200);
  const before = await platform.env.DB.prepare(
    "SELECT expires_at FROM crm_record_history WHERE object_name=? AND record_id=?",
  )
    .bind(name, record.id)
    .first("expires_at");
  expect(
    (
      await request(`/record-history-settings/${name}`, "PUT", {
        enabled: false,
        fields: ["name"],
        retentionDays: 1,
        expectedVersion: 2,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/records/${name}/${record.id}`, "PATCH", {
        name: "Untracked",
        _version: 2,
      })
    ).status,
  ).toBe(200);
  const result = (await (await request(path)).json()) as any;
  expect(result).toMatchObject({ enabled: false, retentionDays: 1 });
  expect(result.data.map((e: any) => e.version)).toEqual([2]);
  expect(
    await platform.env.DB.prepare(
      "SELECT expires_at FROM crm_record_history WHERE object_name=? AND record_id=?",
    )
      .bind(name, record.id)
      .first("expires_at"),
  ).toBe(before);
});

it("honors the factory access policy even when its caller supplies the raw database", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  const selected = createCrmApp("history", {
    principalId: "alice",
    accessPolicy: policy(name),
  });
  const response = await request(
    `/record-history/${name}/${record.id}/1`,
    "GET",
    undefined,
    selected,
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as any).data.changes).toEqual({
    name: { after: "First" },
  });
});

it("previews and restores selected complete values without overwriting concurrent edits", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  await request(`/records/${name}/${record.id}`, "PATCH", {
    name: "Second",
    _version: 1,
  });
  const path = `/record-history/${name}/${record.id}/2/restore`;
  const preview = await request(path);
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({
    data: {
      expectedVersion: 2,
      changes: {
        name: { current: "Second", before: "First", after: "Second" },
      },
    },
  });
  const response = await request(path, "PUT", {
    expectedVersion: 2,
    side: "before",
    fields: ["name"],
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const result = (await (
    await request(`/records/${name}/${record.id}`)
  ).json()) as any;
  expect(result.data).toMatchObject({
    name: "First",
    secret: "hidden",
    _version: 3,
  });
  expect(
    (
      await request(path, "PUT", {
        expectedVersion: 2,
        side: "before",
        fields: ["name"],
      })
    ).status,
  ).toBe(409);
  const history = (await (
    await request(`/record-history/${name}/${record.id}/3`)
  ).json()) as any;
  expect(history.data).toMatchObject({
    actor: { kind: "user", id: "alice" },
    changes: { name: { before: "Second", after: "First" } },
  });
});

it("rejects forbidden, missing, expired and truncated restoration sources", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  const path = `/record-history/${name}/${record.id}/1/restore`;
  expect(
    (
      await request(path, "PUT", {
        expectedVersion: 1,
        side: "before",
        fields: ["name"],
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request(path, "PUT", {
        expectedVersion: 1,
        side: "after",
        fields: ["status"],
      })
    ).status,
  ).toBe(422);
  const reader = createCrmApp("history", {
    principalId: "alice",
    accessPolicy: policy(name),
  });
  expect(
    (
      await request(
        path,
        "PUT",
        { expectedVersion: 1, side: "after", fields: ["name"] },
        reader,
      )
    ).status,
  ).toBe(403);
  await platform.env.DB.prepare(
    "UPDATE crm_record_history SET changes=json_set(changes,'$.name.afterTruncated',json('true')) WHERE object_name=?",
  )
    .bind(name)
    .run();
  expect(
    (
      await request(path, "PUT", {
        expectedVersion: 1,
        side: "after",
        fields: ["name"],
      })
    ).status,
  ).toBe(422);
  await platform.env.DB.prepare(
    "UPDATE crm_record_history SET expires_at='2000-01-01' WHERE object_name=?",
  )
    .bind(name)
    .run();
  expect((await request(path)).status).toBe(404);
});

it("reports bounded collection storage and expired backlog only to schema administrators", async () => {
  const name = await fixture();
  await enable(name);
  await create(name);
  const path = `/record-history-settings/${name}/usage`;
  const response = await request(path);
  expect(response.status).toBe(200);
  const result = (await response.json()) as any;
  expect(result.data).toMatchObject({
    events: 1,
    expiredEvents: 0,
    limited: false,
  });
  expect(result.data.logicalBytes).toBeGreaterThan(0);
  expect((await scoped(name, policy(name))(path)).status).toBe(403);
  await platform.env.DB.prepare(
    "UPDATE crm_record_history SET expires_at='2000-01-01' WHERE object_name=?",
  )
    .bind(name)
    .run();
  expect(await (await request(path)).json()).toMatchObject({
    data: { expiredEvents: 1, oldestExpiredAt: "2000-01-01" },
  });
});

it("restores only writable fields for custom roles and rejects changed schema validation", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  await request(`/records/${name}/${record.id}`, "PATCH", {
    name: "Second",
    _version: 1,
  });
  const p = policy(name);
  p.grants.push({
    ...p.grants[0],
    id: "update",
    action: "update",
    fields: ["name"],
  });
  const selected = createCrmApp("history", {
    principalId: "alice",
    accessPolicy: p,
  });
  const path = `/record-history/${name}/${record.id}/2/restore`;
  const preview = await request(path, "GET", undefined, selected);
  expect(preview.status).toBe(200);
  expect(Object.keys(((await preview.json()) as any).data.changes)).toEqual([
    "name",
  ]);
  expect(
    (
      await request(
        path,
        "PUT",
        { expectedVersion: 2, side: "before", fields: ["name"] },
        selected,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        `/record-history/${name}/${record.id}/1/restore`,
        "PUT",
        { expectedVersion: 3, side: "after", fields: ["secret"] },
        selected,
      )
    ).status,
  ).toBe(422);
  await platform.env.DB.prepare(
    "UPDATE crm_objects SET config=json_set(config,'$.fields.name.type','Number'),version=version+1 WHERE name=?",
  )
    .bind(name)
    .run();
  expect(
    (
      await request(path, "PUT", {
        expectedVersion: 3,
        side: "before",
        fields: ["name"],
      })
    ).status,
  ).toBe(422);
});

it("caps usage scans and does not expose another tenant's collection", async () => {
  const name = await fixture();
  await enable(name);
  const record = await create(name);
  await platform.env.DB.prepare(
    `WITH RECURSIVE n(v) AS (SELECT 2 UNION ALL SELECT v+1 FROM n WHERE v<1001)
    INSERT INTO crm_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,changes,expires_at)
    SELECT 'history',?,?,v,'updated','2026-09-19','system','{}','2099-01-01' FROM n`,
  )
    .bind(name, record.id)
    .run();
  const path = `/record-history-settings/${name}/usage`;
  expect(await (await request(path)).json()).toMatchObject({
    data: { events: 1000, limited: true },
  });
  expect(
    (
      await request(
        path,
        "GET",
        undefined,
        createCrmApp("other", { principalId: "bob" }),
      )
    ).status,
  ).toBe(404);
});
