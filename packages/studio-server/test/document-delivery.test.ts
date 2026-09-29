import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { createStudioApp } from "../src/index";
import type { Env } from "../src/context";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env["Bindings"]>>>;
const copy = vi.fn(async (_input: { content: Uint8Array }) => ({
  id: "remote",
  name: "proposal.docx",
  webUrl: "https://onedrive.live.com/example",
}));
const send = vi.fn(async () => undefined);
const payloads = new Map<string, Record<string, unknown>>();
const bridge = {
  connections: async () => [
    {
      id: "connection-1",
      provider: "onedrive_personal" as const,
      status: "connected",
      externalAccountLabel: "user@example.test",
    },
    {
      id: "outlook-1",
      provider: "outlook" as const,
      status: "connected",
      externalAccountLabel: "user@example.test",
    },
  ],
  folders: async () => [],
  saveCopy: copy,
  sendEmail: send,
  seal: async (id: string, payload: Record<string, unknown>) => {
    payloads.set(id, payload);
    return "encrypted-token";
  },
  unseal: async (id: string, token: string) => {
    if (token !== "encrypted-token" || !payloads.has(id))
      throw new Error("invalid");
    return payloads.get(id)!;
  },
};
const app = createStudioApp("tenant:1", {
  principalId: "editor-1",
  documentDelivery: bridge,
});
const req = (path: string, body?: unknown, instance = app) =>
  instance.request(
    "http://localhost/api/file/doc-1/delivery" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
    platform.env,
  );
const prepare = async () => {
  const r = await req("/prepare", {
    action: "onedrive",
    connectionKey: "connection-1",
    version: 1,
    provider: "onedrive_personal",
    name: "proposal.docx",
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as any).data;
};
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
  await platform.env.DB.prepare(
    `INSERT INTO studio_objects(tenant_id,name,label,description,config) VALUES ('tenant:1','proposals','Proposals','','{"fields":{}}')`,
  ).run();
  await platform.env.DB.prepare(
    `INSERT INTO studio_records(id,tenant_id,object_name,data) VALUES ('record-1','tenant:1','proposals','{}')`,
  ).run();
  await platform.env.DB.prepare(
    `INSERT INTO studio_files(id,tenant_id,object_name,record_id,name,mime,size,storage_key) VALUES ('doc-1','tenant:1','proposals','record-1','proposal.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',4,'document-1')`,
  ).run();
  await platform.env.FILES.put("document-1", new Uint8Array([0, 1, 254, 255]));
});
afterAll(async () => platform?.dispose());
describe("document delivery", () => {
  it("prepares without external writes and executes a confirmation only once", async () => {
    const prepared = await prepare();
    expect(copy).not.toHaveBeenCalled();
    const results = await Promise.all([
      req("/confirm", prepared),
      req("/confirm", prepared),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0]?.[0].content).toEqual(
      new Uint8Array([0, 1, 254, 255]),
    );
    const history = ((await (await req("")).json()) as any).data.history;
    expect(history[0]).toMatchObject({
      version: 1,
      actorId: "editor-1",
      status: "succeeded",
    });
    expect(JSON.stringify(history)).not.toContain("encrypted-token");
  });
  it("binds confirmation to tenant, principal, file version and expiry", async () => {
    const prepared = await prepare();
    const other = createStudioApp("tenant:1", {
      principalId: "other",
      documentDelivery: bridge,
    });
    expect((await req("/confirm", prepared, other)).status).toBe(409);
    const tenant = createStudioApp("tenant:2", {
      principalId: "editor-1",
      documentDelivery: bridge,
    });
    expect((await req("/confirm", prepared, tenant)).status).toBe(404);
    expect(
      (await req("/confirm", { ...prepared, token: "tampered" })).status,
    ).toBe(409);
    payloads.get(prepared.confirmationId)!.expiresAt =
      "2000-01-01T00:00:00.000Z";
    expect((await req("/confirm", prepared)).status).toBe(409);
    const stale = await prepare();
    await platform.env.DB.prepare(
      "UPDATE studio_files SET version=2 WHERE id='doc-1'",
    ).run();
    expect((await req("/confirm", stale)).status).toBe(409);
    await platform.env.DB.prepare(
      "UPDATE studio_files SET version=1 WHERE id='doc-1'",
    ).run();
  });
  it("rechecks attachment field grants and connection identity at confirmation", async () => {
    await platform.env.DB.prepare(
      "UPDATE studio_files SET field_name='documents' WHERE id='doc-1'",
    ).run();
    const restricted = createStudioApp("tenant:1", {
      principalId: "editor-1",
      documentDelivery: bridge,
      accessPolicy: {
        principalId: "editor-1",
        scope: "tenant:1",
        revision: 0,
        grants: [
          {
            id: "r",
            roleId: "role",
            resource: "collection:proposals",
            action: "read",
            predicate: { all: true },
            fields: ["documents"],
          },
          {
            id: "e",
            roleId: "role",
            resource: "collection:proposals",
            action: "export",
            predicate: { all: true },
            fields: ["name"],
          },
        ],
      },
    });
    expect((await req("", undefined, restricted)).status).toBe(403);
    await platform.env.DB.prepare(
      "UPDATE studio_files SET field_name='' WHERE id='doc-1'",
    ).run();
    const prepared = await prepare();
    const switched = createStudioApp("tenant:1", {
      principalId: "editor-1",
      documentDelivery: {
        ...bridge,
        connections: async () => [
          {
            id: "new-connection",
            provider: "onedrive_personal",
            status: "connected",
            externalAccountLabel: "other@example.test",
          },
        ],
      },
    });
    expect((await req("/confirm", prepared, switched)).status).toBe(409);
  });
  it("accepts opaque folder identifiers and rejects path separators", async () => {
    expect(
      (
        await req(
          "/folders?provider=onedrive_personal&parentId=" +
            encodeURIComponent("opaque+id= value"),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await req(
          "/folders?provider=onedrive_personal&parentId=" +
            encodeURIComponent("bad/id"),
        )
      ).status,
    ).toBe(422);
  });
  it("sends the saved bytes through Outlook and stores no recipients or body in history", async () => {
    const response = await req("/prepare", {
      action: "outlook",
      connectionKey: "outlook-1",
      version: 1,
      to: ["recipient@example.test"],
      subject: "Proposal",
      body: "Private message",
    });
    expect(response.status).toBe(200);
    const prepared = ((await response.json()) as any).data;
    expect((await req("/confirm", prepared)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const rows = await platform.env.DB.prepare(
      "SELECT response FROM studio_requests",
    ).all();
    expect(JSON.stringify(rows.results)).not.toContain(
      "recipient@example.test",
    );
    expect(JSON.stringify(rows.results)).not.toContain("Private message");
  });
  it("rejects missing export permission and keeps unknown outcomes non-replayable", async () => {
    const restricted = createStudioApp("tenant:1", {
      principalId: "editor-1",
      documentDelivery: bridge,
      accessPolicy: {
        principalId: "editor-1",
        scope: "tenant:1",
        revision: 0,
        grants: [],
      } as any,
    });
    expect(
      (
        await req(
          "/prepare",
          {
            action: "onedrive",
            connectionKey: "connection-1",
            provider: "onedrive_personal",
            version: 1,
            name: "copy.docx",
          },
          restricted,
        )
      ).status,
    ).toBe(403);
    const prepared = await prepare();
    copy.mockRejectedValueOnce(new Error("network"));
    expect((await req("/confirm", prepared)).status).toBe(502);
    expect((await req("/confirm", prepared)).status).toBe(409);
    const history = ((await (await req("")).json()) as any).data.history;
    expect(history.some((entry: any) => entry.status === "unknown")).toBe(true);
  });
});

it("loads persisted delivery history for UUID file IDs within D1 pattern limits", async () => {
  const id = "fe069bce-f35e-4cc3-91f9-a657f391f4b7";
  await platform.env.DB.prepare(
    "INSERT INTO studio_files(id,tenant_id,object_name,record_id,name,mime,size,storage_key) VALUES (?,'tenant:1','proposals','record-1','history.csv','text/csv',4,'document-uuid')",
  )
    .bind(id)
    .run();
  const entry = {
    id: "history-uuid",
    action: "outlook",
    provider: "outlook",
    status: "succeeded",
    version: 1,
    actorId: "editor-1",
    createdAt: "2026-09-29T00:19:28.689Z",
  };
  await platform.env.DB.prepare(
    "INSERT INTO studio_requests(tenant_id,request_key,fingerprint,response) VALUES (?,?,?,?)",
  )
    .bind(
      "tenant:1",
      `document-delivery:${id}:2026-09-29:entry`,
      "editor-1",
      JSON.stringify(entry),
    )
    .run();
  const response = await app.request(
    `http://localhost/api/file/${id}/delivery`,
    {},
    platform.env,
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as any).data.history).toEqual([entry]);
});
