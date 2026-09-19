import { beforeAll, it, expect } from "vitest";
import { createAccessFixture } from "./access-control-fixtures";
let f: Awaited<ReturnType<typeof createAccessFixture>>;
const base = "/v1/access-control/audit";
const get = (
  query = "",
  role: "agency_admin" | "viewer" | "platform_admin" = "agency_admin",
) => f.request(role, 101, base + "?scope=tenant:101" + query);
beforeAll(async () => {
  f = await createAccessFixture();
  for (const [id, scope, action, actor] of [
    ["a", "tenant:101", "role.saved", "gone"],
    ["b", "tenant:101", "role.deleted", "acl-agency_admin"],
    ["c", "tenant:101", "assignments.saved", "gone"],
    ["foreign", "tenant:102", "role.saved", "gone"],
  ])
    await f.db
      .prepare(
        "INSERT INTO access_audit(id,scope,actor_id,action,target_id,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        scope,
        actor,
        action,
        "target",
        '{"old":true}',
        '{"new":true}',
        "2026-09-19T12:00:00.000Z",
      )
      .run();
});
it("pages timestamp ties without exposing snapshots and preserves deleted actors", async () => {
  const response = await get("&limit=2");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const page = (await response.json()) as any;
  expect(page.data.map((r: any) => r.id)).toEqual(["c", "b"]);
  expect(page.data[0]).toEqual({
    id: "c",
    scope: "tenant:101",
    actor: { id: "gone", displayName: "gone" },
    action: "assignments.saved",
    targetId: "target",
    createdAt: "2026-09-19T12:00:00.000Z",
  });
  await f.db
    .prepare(
      "INSERT INTO access_audit(id,scope,actor_id,action,target_id,created_at) VALUES ('z','tenant:101','gone','role.saved','target','2026-09-19T12:00:00.000Z')",
    )
    .run();
  const next = (await (
    await get("&limit=2&cursor=" + encodeURIComponent(page.nextCursor))
  ).json()) as any;
  expect(next.data.map((r: any) => r.id)).toEqual(["a"]);
  expect(next.nextCursor).toBeNull();
  expect(
    (
      await get(
        "&action=role.saved&cursor=" + encodeURIComponent(page.nextCursor),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await f.request(
        "platform_admin",
        101,
        base +
          "?scope=tenant:102&cursor=" +
          encodeURIComponent(page.nextCursor),
      )
    ).status,
  ).toBe(422);
});
it("returns explicit details and hides foreign IDs", async () => {
  const response = await f.request(
    "agency_admin",
    101,
    base + "/a?scope=tenant:101",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    id: "a",
    before: { old: true },
    after: { new: true },
  });
  expect(
    (await f.request("agency_admin", 101, base + "/foreign?scope=tenant:101"))
      .status,
  ).toBe(404);
  expect(
    (await f.request("agency_admin", 101, base + "/missing?scope=tenant:101"))
      .status,
  ).toBe(404);
});
it("filters exact values and inclusive UTC time bounds", async () => {
  const page = (await (
    await get(
      "&action=role.deleted&actorId=acl-agency_admin&targetId=target&from=2026-09-19T12:00:00Z&to=2026-09-19T12:00:00Z",
    )
  ).json()) as any;
  expect(page.data.map((r: any) => r.id)).toEqual(["b"]);
  expect(await (await get("&targetId=missing")).json()).toEqual({
    data: [],
    nextCursor: null,
  });
});
it("validates bounded filters and cursors", async () => {
  for (const query of [
    "&limit=0",
    "&limit=101",
    "&limit=1.5",
    "&action=unknown",
    "&from=no",
    "&from=2026-09-20T00:00:00Z&to=2026-09-19T00:00:00Z",
    "&cursor=no",
    "&actorId=" + "a".repeat(257),
  ])
    expect((await get(query)).status).toBe(422);
});
it("bounds default and maximum page sizes and supports null snapshots", async () => {
  await f.db.batch(
    Array.from({ length: 102 }, (_, i) =>
      f.db
        .prepare(
          "INSERT INTO access_audit(id,scope,actor_id,action,target_id,created_at) VALUES (?,'tenant:101','gone','role.saved','bulk','2026-09-18T12:00:00.000Z')",
        )
        .bind("bulk-" + String(i).padStart(3, "0")),
    ),
  );
  const normal = (await (await get("&targetId=bulk")).json()) as any;
  expect(normal.data).toHaveLength(25);
  expect(normal.nextCursor).toEqual(expect.any(String));
  const maximum = (await (await get("&targetId=bulk&limit=100")).json()) as any;
  expect(maximum.data).toHaveLength(100);
  const detail = await (
    await f.request("agency_admin", 101, base + "/bulk-001?scope=tenant:101")
  ).json();
  expect(detail).toMatchObject({ before: null, after: null });
});
it("reauthorizes every request against current scope authority", async () => {
  expect((await get("", "viewer")).status).toBe(403);
  expect(
    (await f.request("agency_admin", 101, base + "?scope=tenant:102")).status,
  ).toBe(403);
  await f.db
    .prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='acl-agency_admin'",
    )
    .run();
  expect((await get()).status).toBe(403);
  expect(
    (await f.request("agency_admin", 101, base + "/a?scope=tenant:101")).status,
  ).toBe(403);
});
