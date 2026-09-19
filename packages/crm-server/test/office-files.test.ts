import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { createCrmApp } from "../src/index";
import type { Env } from "../src/context";
let platform: Awaited<ReturnType<typeof getPlatformProxy<Env["Bindings"]>>>;
const app = createCrmApp("agency:1", { principalId: "editor-1" });
const other = createCrmApp("agency:2", { principalId: "editor-2" });
const bytes = readFileSync(new URL("./fixtures/office.docx", import.meta.url));
let sequence = 0;
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
    "INSERT INTO crm_objects(tenant_id,name,label,description,config) VALUES ('agency:1','contracts','Contracts','','{\"fields\":{}}')",
  ).run();
  await platform.env.DB.prepare(
    "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES ('record-1','agency:1','contracts','{}')",
  ).run();
});
afterAll(async () => {
  await platform?.dispose();
});
async function seed() {
  const id = "office-" + ++sequence,
    key = "agency:1/record-1/" + id;
  await platform.env.FILES.put(key, bytes);
  await platform.env.DB.prepare(
    "INSERT INTO crm_files(id,tenant_id,object_name,record_id,name,mime,size,storage_key) VALUES (?,'agency:1','contracts','record-1','policy.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',?,?)",
  )
    .bind(id, bytes.length, key)
    .run();
  return { id, key };
}
const req = (path: string, init?: RequestInit) =>
  app.request("http://localhost/api" + path, init, platform.env);
async function save(id: string, version: number, content: Uint8Array = bytes) {
  const form = new FormData();
  form.set("version", String(version));
  form.set(
    "file",
    new File([content], "policy.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  return req("/file/" + id + "/revisions", { method: "POST", body: form });
}
describe("Office revisions on real D1 and R2", () => {
  it("returns editable metadata only within the owning tenant", async () => {
    const { id } = await seed();
    const response = await req("/file/" + id + "/office");
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).data).toMatchObject({
      id,
      version: 1,
      name: "policy.docx",
      recordId: "record-1",
    });
    expect(
      (
        await other.request(
          "http://localhost/api/file/" + id + "/office",
          {},
          platform.env,
        )
      ).status,
    ).toBe(404);
  });
  it("retains original and edited bytes with author and downloadable history", async () => {
    const { id, key } = await seed();
    const response = await save(id, 1);
    expect(response.status, await response.clone().text()).toBe(201);
    expect(((await response.json()) as any).data.version).toBe(2);
    const revisions = await req("/file/" + id + "/revisions");
    const data = ((await revisions.json()) as any).data;
    expect(data.map((r: any) => r.version)).toEqual([2, 1]);
    expect(data[0].created_by).toBe("editor-1");
    for (const version of [1, 2]) {
      const download = await req(
        "/file/" + id + "/revisions/" + version + "/download",
      );
      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(
        new Uint8Array(bytes),
      );
    }
    expect(await platform.env.FILES.head(key)).not.toBeNull();
  });
  it("rejects stale saves and allows only one concurrent writer", async () => {
    const { id } = await seed();
    const responses = await Promise.all([save(id, 1), save(id, 1)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await save(id, 1)).status).toBe(409);
    expect(
      (
        await platform.env.DB.prepare(
          "SELECT count(*) AS n FROM crm_file_revisions WHERE file_id=?",
        )
          .bind(id)
          .first<any>()
      ).n,
    ).toBe(2);
  });
  it("rejects corrupt office files without adding revisions", async () => {
    const { id } = await seed();
    expect(
      (await save(id, 1, new TextEncoder().encode("not a ZIP"))).status,
    ).toBe(422);
    expect(
      (
        await platform.env.DB.prepare(
          "SELECT version FROM crm_files WHERE id=?",
        )
          .bind(id)
          .first<any>()
      ).version,
    ).toBe(1);
  });
  it("rejects saves after the parent record is deleted", async () => {
    const { id } = await seed();
    await platform.env.DB.prepare(
      "UPDATE crm_records SET deleted_at='2026-09-19' WHERE id='record-1'",
    ).run();
    expect((await save(id, 1)).status).toBe(404);
    await platform.env.DB.prepare(
      "UPDATE crm_records SET deleted_at=NULL WHERE id='record-1'",
    ).run();
  });
  it("keeps revision downloads private and removes access after deleting the file", async () => {
    const { id } = await seed();
    expect((await save(id, 1)).status).toBe(201);
    expect(
      (
        await other.request(
          "http://localhost/api/file/" + id + "/revisions/1/download",
          {},
          platform.env,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req("/file/" + id, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 2 }),
        })
      ).status,
    ).toBe(200);
    expect((await req("/file/" + id + "/revisions/1/download")).status).toBe(
      404,
    );
  });
  it("does not remove bytes when a save wins the race with deletion", async () => {
    const { id, key } = await seed();
    const db = platform.env.DB;
    const racingDb = new Proxy(db, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            expect((await save(id, 1)).status).toBe(201);
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await app.request(
      "http://localhost/api/file/" + id,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      },
      { ...platform.env, DB: racingDb },
    );
    expect(response.status).toBe(409);
    expect(await platform.env.FILES.head(key)).not.toBeNull();
    expect((await req("/file/" + id + "/revisions/2/download")).status).toBe(
      200,
    );
  });
  it("preserves the original when object storage rejects the new revision", async () => {
    const { id, key } = await seed();
    const bucket = new Proxy(platform.env.FILES, {
      get(target, property) {
        if (property === "put")
          return async () => {
            throw new Error("Synthetic storage failure");
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const form = new FormData();
    form.set("version", "1");
    form.set(
      "file",
      new File([bytes], "policy.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const response = await app.request(
      "http://localhost/api/file/" + id + "/revisions",
      { method: "POST", body: form },
      { ...platform.env, FILES: bucket },
    );
    expect(response.status).toBe(500);
    expect(await platform.env.FILES.head(key)).not.toBeNull();
    expect(
      ((await (await req("/file/" + id + "/office")).json()) as any).data
        .version,
    ).toBe(1);
  });
  it("rejects oversized revisions without changing the file", async () => {
    const { id } = await seed();
    expect(
      (await save(id, 1, new Uint8Array(5 * 1024 * 1024 + 1))).status,
    ).toBe(413);
    expect(
      ((await (await req("/file/" + id + "/office")).json()) as any).data
        .version,
    ).toBe(1);
  });

  it("respects a read-only attachment field", async () => {
    const { id } = await seed();
    await platform.env.DB.prepare(
      "UPDATE crm_objects SET config=? WHERE tenant_id='agency:1' AND name='contracts'",
    )
      .bind(
        JSON.stringify({
          fields: {
            document: {
              type: "R2Attachment",
              label: "Document",
              readOnly: true,
            },
          },
        }),
      )
      .run();
    await platform.env.DB.prepare(
      "UPDATE crm_files SET field_name='document' WHERE id=?",
    )
      .bind(id)
      .run();
    try {
      expect(
        ((await (await req("/file/" + id + "/office")).json()) as any).data
          .readOnly,
      ).toBe(true);
      expect((await save(id, 1)).status).toBe(403);
    } finally {
      await platform.env.DB.prepare(
        "UPDATE crm_objects SET config='{\"fields\":{}}' WHERE tenant_id='agency:1' AND name='contracts'",
      ).run();
    }
  });
});
