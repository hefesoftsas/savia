import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerPagesRoutes } from "../src/routes/pages";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

async function applyMigrations() {
  for (const [, sql] of migrations) {
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
}

const baseActor = (id: string, tenantId: number): AppActor => ({
  principal: {
    id,
    issuer: "savia:test",
    subject: id,
    email: `${id}@savia.test`,
    displayName: id,
    isActive: true,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  },
  globalRoles: [],
  memberships: [
    {
      id: `membership-${id}`,
      principalId: id,
      agencyId: tenantId,
      tenantId,
      role: "viewer",
      isActive: true,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  ],
});

function memoryBucket() {
  const contents = new Map<string, Uint8Array>();
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | ReadableStream,
    ) {
      const bytes =
        value instanceof ReadableStream
          ? new Uint8Array(await new Response(value).arrayBuffer())
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      contents.set(key, bytes.slice());
    },
    async get(key: string) {
      const bytes = contents.get(key);
      return bytes
        ? {
            body: new ReadableStream({
              start(c) {
                c.enqueue(bytes);
                c.close();
              },
            }),
          }
        : null;
    },
    async delete(key: string) {
      contents.delete(key);
    },
    contents,
  };
  return bucket as unknown as R2Bucket & { contents: Map<string, Uint8Array> };
}

function appFor(user: AppActor, documents: R2Bucket) {
  const app = new OpenAPIHono();
  const auth: Authenticator = {
    async authenticate() {
      return user;
    },
  };
  app.use("*", authenticationMiddleware(env.DB, auth));
  registerPagesRoutes(app, env.DB, documents);
  return app;
}

async function seed() {
  await env.DB.prepare(
    "DELETE FROM page_files WHERE tenant_id IN (9301,9302)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM page_shares WHERE tenant_id IN (9301,9302)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM pages WHERE tenant_id IN (9301,9302)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_tenant_membership WHERE tenant_id IN (9301,9302)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_principal WHERE id IN ('transfer-owner','transfer-reader','transfer-target')",
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id,id_slug,name,is_active,created_at,updated_at)
    VALUES (9301,'transfer-one','Transfer One',1,'2026-09-05','2026-09-05'),
           (9302,'transfer-two','Transfer Two',1,'2026-09-05','2026-09-05')`,
  ).run();
  for (const id of ["transfer-owner", "transfer-reader", "transfer-target"]) {
    await env.DB.prepare(
      `INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at)
      VALUES (?,'savia:test',?,?,?,1,'2026-09-05','2026-09-05')`,
    )
      .bind(id, id, `${id}@savia.test`, id)
      .run();
  }
  for (const [id, tenant] of [
    ["transfer-owner", 9301],
    ["transfer-reader", 9301],
    ["transfer-target", 9302],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
      VALUES (?,?,?,'viewer',1,'2026-09-05','2026-09-05')`,
    )
      .bind(`membership-${id}`, id, tenant)
      .run();
  }
}

const json = (response: Response) => response.json() as Promise<any>;

describe("Pages portable transfer API", () => {
  beforeAll(applyMigrations);
  beforeEach(seed);

  it("exports every owned page past the list limit and imports private copies with attachment bytes", async () => {
    const owner = baseActor("transfer-owner", 9301);
    const target = baseActor("transfer-target", 9302);
    const parentId = "transfer-root";
    const childId = "transfer-child";
    const grandchildId = "transfer-grandchild";
    await env.DB.prepare(
      `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
      VALUES (?,9301,'transfer-owner',NULL,?,'Root','folder','[]','',NULL,3,1,'2026-09-05','2026-09-05'),
             (?,9301,'transfer-owner',?,?, 'Child','page',?,'',NULL,4,1,'2026-09-05','2026-09-05'),
             (?,9301,'transfer-owner',?,?, 'Grandchild','page','[]','',NULL,1,1,'2026-09-05','2026-09-05')`,
    )
      .bind(
        parentId,
        parentId,
        childId,
        parentId,
        parentId,
        JSON.stringify([
          { type: "p", children: [{ text: "portable" }] },
          {
            type: "attachment",
            fileId: "transfer-file",
            name: "note.txt",
            mimeType: "text/plain",
            children: [],
          },
          {
            type: "collection",
            domain: "/v1/studio/1",
            collection: "contacts",
            mode: "table",
            children: [],
          },
        ]),
        grandchildId,
        childId,
        parentId,
      )
      .run();
    for (let index = 0; index < 205; index++) {
      const id = `transfer-extra-${index}`;
      await env.DB.prepare(
        `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
        VALUES (?,9301,'transfer-owner',NULL,?,?,'page','[]','',NULL,1,1,'2026-09-05','2026-09-05')`,
      )
        .bind(id, id, `Extra ${index}`)
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
      VALUES ('transfer-shared',9301,'transfer-reader',NULL,'transfer-shared','Shared','page','[]','',NULL,1,1,'2026-09-05','2026-09-05')`,
    ).run();
    await env.DB.prepare(
      "INSERT INTO page_shares(root_id,tenant_id,principal_id,role,created_at) VALUES('transfer-shared',9301,'transfer-owner','reader','2026-09-05')",
    ).run();
    const bytes = new TextEncoder().encode("portable attachment");
    await env.DOCUMENTS.put("pages/transfer-file", bytes);
    await env.DB.prepare(
      `INSERT INTO page_files(id,page_id,root_id,tenant_id,storage_key,file_name,mime_type,size,created_at)
      VALUES('transfer-file',?,? ,9301,'pages/transfer-file','note.txt','text/plain',?,'2026-09-05')`,
    )
      .bind(childId, parentId, bytes.length)
      .run();
    await env.DB.prepare(
      `INSERT INTO page_files(id,page_id,root_id,tenant_id,storage_key,file_name,mime_type,size,created_at)
      VALUES('transfer-unreferenced',?,? ,9301,'pages/transfer-unreferenced','unused.txt','text/plain',1,'2026-09-05')`,
    )
      .bind(grandchildId, parentId)
      .run();

    const response = await appFor(owner, env.DOCUMENTS).request(
      "/v1/pages/export",
    );
    expect(response.status).toBe(200);
    const archive = (await json(response)).data;
    expect(archive.pages).toHaveLength(208);
    expect(archive.pages.map((page: any) => page.id)).not.toContain(
      "transfer-shared",
    );
    expect(
      archive.pages.find((page: any) => page.id === childId).parentId,
    ).toBe(parentId);
    expect(archive.files).toHaveLength(1);
    expect(archive.files[0].data).toBe(btoa("portable attachment"));

    const imported = await appFor(target, env.DOCUMENTS).request(
      "/v1/pages/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(archive),
      },
    );
    expect(imported.status).toBe(200);
    expect((await json(imported)).data).toEqual({
      pages: 207,
      folders: 1,
      files: 1,
    });
    const importedAgain = await appFor(target, env.DOCUMENTS).request(
      "/v1/pages/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(archive),
      },
    );
    expect(importedAgain.status).toBe(200);
    const copied = await env.DB.prepare(
      "SELECT id,parent_id,root_id,owner_id,tenant_id,kind FROM pages WHERE owner_id='transfer-target'",
    ).all<any>();
    expect(copied.results).toHaveLength(416);
    const copiedRoot = copied.results?.find(
      (page: any) => page.kind === "folder",
    );
    const copiedChild = copied.results?.find(
      (page: any) => page.parent_id === copiedRoot?.id,
    );
    const copiedGrandchild = copied.results?.find(
      (page: any) => page.parent_id === copiedChild?.id,
    );
    expect(copiedRoot?.root_id).toBe(copiedRoot?.id);
    expect(copiedChild?.root_id).toBe(copiedRoot?.id);
    expect(copiedChild?.id).not.toBe(childId);
    expect(copiedChild?.tenant_id).toBe(9302);
    expect(copiedChild?.owner_id).toBe("transfer-target");
    expect(copiedGrandchild?.parent_id).toBe(copiedChild?.id);
    expect(
      await env.DB.prepare("SELECT 1 FROM page_shares WHERE root_id=?")
        .bind(copiedRoot?.id)
        .first(),
    ).toBeNull();
    const copiedContent = await env.DB.prepare(
      "SELECT content_json FROM pages WHERE id=?",
    )
      .bind(copiedChild?.id)
      .first<any>();
    const importedNodes = JSON.parse(copiedContent.content_json);
    expect(importedNodes[1].fileId).not.toBe("transfer-file");
    expect(importedNodes[2].type).toBe("p");
    expect(importedNodes[2].children[0].text).toContain(
      "detached during import",
    );
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM page_revisions WHERE page_id IN (SELECT id FROM pages WHERE owner_id='transfer-target')",
        ).first<any>()
      ).count,
    ).toBe(416);
    const importedKeys = await env.DB.prepare(
      "SELECT storage_key FROM page_files WHERE tenant_id=9302",
    ).all<any>();
    await Promise.all(
      (importedKeys.results ?? []).map((file: any) =>
        env.DOCUMENTS.delete(file.storage_key),
      ),
    );
    await env.DOCUMENTS.delete("pages/transfer-file");
  });

  it.each([
    [
      "orphan hierarchy",
      {
        pages: [
          {
            id: "orphan",
            parentId: "missing",
            title: "Orphan",
            kind: "page",
            content: [],
          },
        ],
        files: [],
      },
    ],
    [
      "duplicate page IDs",
      {
        pages: [
          {
            id: "same",
            parentId: null,
            title: "One",
            kind: "page",
            content: [],
          },
          {
            id: "same",
            parentId: null,
            title: "Two",
            kind: "page",
            content: [],
          },
        ],
        files: [],
      },
    ],
    [
      "cyclic hierarchy",
      {
        pages: [
          { id: "a", parentId: "b", title: "A", kind: "page", content: [] },
          { id: "b", parentId: "a", title: "B", kind: "page", content: [] },
        ],
        files: [],
      },
    ],
    [
      "missing attachment reference",
      {
        pages: [
          {
            id: "p",
            parentId: null,
            title: "P",
            kind: "page",
            content: [
              {
                type: "attachment",
                fileId: "missing",
                name: "a.txt",
                mimeType: "text/plain",
                children: [],
              },
            ],
          },
        ],
        files: [],
      },
    ],
    [
      "non-canonical base64",
      {
        pages: [
          {
            id: "p",
            parentId: null,
            title: "P",
            kind: "page",
            content: [
              {
                type: "attachment",
                fileId: "f",
                name: "a.txt",
                mimeType: "text/plain",
                children: [],
              },
            ],
          },
        ],
        files: [
          {
            id: "f",
            pageId: "p",
            name: "a.txt",
            mimeType: "text/plain",
            size: 1,
            data: "Y=== ",
          },
        ],
      },
    ],
    [
      "attachment size mismatch",
      {
        pages: [
          {
            id: "p",
            parentId: null,
            title: "P",
            kind: "page",
            content: [
              {
                type: "attachment",
                fileId: "f",
                name: "a.txt",
                mimeType: "text/plain",
                children: [],
              },
            ],
          },
        ],
        files: [
          {
            id: "f",
            pageId: "p",
            name: "a.txt",
            mimeType: "text/plain",
            size: 2,
            data: "YQ==",
          },
        ],
      },
    ],
    [
      "unsupported MIME",
      {
        pages: [
          {
            id: "p",
            parentId: null,
            title: "P",
            kind: "page",
            content: [
              {
                type: "attachment",
                fileId: "f",
                name: "a.txt",
                mimeType: "text/plain",
                children: [],
              },
            ],
          },
        ],
        files: [
          {
            id: "f",
            pageId: "p",
            name: "a.txt",
            mimeType: "application/x-msdownload",
            size: 1,
            data: "YQ==",
          },
        ],
      },
    ],
    [
      "duplicate file IDs",
      {
        pages: [
          {
            id: "p",
            parentId: null,
            title: "P",
            kind: "page",
            content: [
              {
                type: "attachment",
                fileId: "f",
                name: "a.txt",
                mimeType: "text/plain",
                children: [],
              },
            ],
          },
        ],
        files: [
          {
            id: "f",
            pageId: "p",
            name: "a.txt",
            mimeType: "text/plain",
            size: 1,
            data: "YQ==",
          },
          {
            id: "f",
            pageId: "p",
            name: "b.txt",
            mimeType: "text/plain",
            size: 1,
            data: "YQ==",
          },
        ],
      },
    ],
  ])("rejects %s before writing any rows", async (_label, payload) => {
    const app = appFor(baseActor("transfer-target", 9302), env.DOCUMENTS);
    const response = await app.request("/v1/pages/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "savia-pages",
        version: 1,
        exportedAt: new Date().toISOString(),
        ...payload,
      }),
    });
    expect(response.status).toBe(400);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM pages WHERE owner_id='transfer-target'",
        ).first<any>()
      ).count,
    ).toBe(0);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM page_files WHERE tenant_id=9302",
        ).first<any>()
      ).count,
    ).toBe(0);
  });

  it("rejects unsupported archive versions without writing rows", async () => {
    const response = await appFor(
      baseActor("transfer-target", 9302),
      env.DOCUMENTS,
    ).request("/v1/pages/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: "savia-pages",
        version: 2,
        exportedAt: new Date().toISOString(),
        pages: [],
        files: [],
      }),
    });
    expect(response.status).toBe(400);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM pages WHERE owner_id='transfer-target'",
        ).first<any>()
      ).count,
    ).toBe(0);
  });

  it("rechecks tenant activity at commit and removes blobs if membership disappears during upload", async () => {
    const bucket = memoryBucket();
    const originalPut = bucket.put.bind(bucket);
    bucket.put = async (
      key: string,
      value: ArrayBuffer | ArrayBufferView | ReadableStream,
    ) => {
      await originalPut(key, value);
      await env.DB.prepare(
        "UPDATE identity_principal SET is_active=0 WHERE id='transfer-target'",
      ).run();
    };
    const archive = {
      format: "savia-pages",
      version: 1,
      exportedAt: new Date().toISOString(),
      pages: [
        {
          id: "copy",
          parentId: null,
          title: "Copy",
          kind: "page",
          content: [
            {
              type: "attachment",
              fileId: "f",
              name: "a.txt",
              mimeType: "text/plain",
              children: [],
            },
          ],
        },
      ],
      files: [
        {
          id: "f",
          pageId: "copy",
          name: "a.txt",
          mimeType: "text/plain",
          size: 1,
          data: "YQ==",
        },
      ],
    };
    try {
      const response = await appFor(
        baseActor("transfer-target", 9302),
        bucket,
      ).request("/v1/pages/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(archive),
      });
      expect(response.status).toBe(500);
      expect(bucket.contents.size).toBe(0);
      expect(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) AS count FROM pages WHERE owner_id='transfer-target'",
          ).first<any>()
        ).count,
      ).toBe(0);
    } finally {
      await env.DB.prepare(
        "UPDATE identity_principal SET is_active=1 WHERE id='transfer-target'",
      ).run();
    }
  });

  it("fails export when a referenced attachment blob is missing", async () => {
    await env.DB.prepare(
      `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
      VALUES ('transfer-missing-page',9301,'transfer-owner',NULL,'transfer-missing-page','Missing','page',?,'',NULL,1,1,'2026-09-05','2026-09-05')`,
    )
      .bind(
        JSON.stringify([
          {
            type: "attachment",
            fileId: "transfer-missing-file",
            name: "lost.txt",
            mimeType: "text/plain",
            children: [],
          },
        ]),
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO page_files(id,page_id,root_id,tenant_id,storage_key,file_name,mime_type,size,created_at)
      VALUES('transfer-missing-file','transfer-missing-page','transfer-missing-page',9301,'pages/transfer-missing-file','lost.txt','text/plain',1,'2026-09-05')`,
    ).run();
    const response = await appFor(
      baseActor("transfer-owner", 9301),
      env.DOCUMENTS,
    ).request("/v1/pages/export");
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe("PAGE_FILE_MISSING");
  });

  it("cleans uploaded blobs when the import database batch fails", async () => {
    const bucket = memoryBucket();
    const archive = {
      format: "savia-pages",
      version: 1,
      exportedAt: new Date().toISOString(),
      pages: [
        {
          id: "copy",
          parentId: null,
          title: "Copy",
          kind: "page",
          content: [
            {
              type: "attachment",
              fileId: "f",
              name: "a.txt",
              mimeType: "text/plain",
              children: [],
            },
          ],
        },
      ],
      files: [
        {
          id: "f",
          pageId: "copy",
          name: "a.txt",
          mimeType: "text/plain",
          size: 1,
          data: "YQ==",
        },
      ],
    };
    const app = appFor(baseActor("transfer-target", 9302), bucket);
    await env.DB.prepare(
      "CREATE TRIGGER fail_transfer_page BEFORE INSERT ON pages WHEN NEW.owner_id='transfer-target' BEGIN SELECT RAISE(ABORT,'forced failure'); END",
    ).run();
    const response = await app.request("/v1/pages/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(archive),
    });
    await env.DB.prepare("DROP TRIGGER fail_transfer_page").run();
    expect(response.status).toBe(500);
    expect(bucket.contents.size).toBe(0);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM pages WHERE owner_id='transfer-target'",
        ).first<any>()
      ).count,
    ).toBe(0);
  });
});
