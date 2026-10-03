import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import { PagesService } from "../src/pages/service";
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
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((entry) =>
        entry
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
}

function actor(id: string, tenantId?: number): AppActor {
  return {
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
    memberships:
      tenantId === undefined
        ? []
        : [
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
  };
}

function appFor(user: AppActor, documents?: R2Bucket) {
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
  for (const table of ["page_files", "page_shares", "page_revisions", "pages"])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare(
    "DELETE FROM identity_tenant_membership WHERE tenant_id IN (9201, 9202)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_principal WHERE id IN ('page-owner', 'page-reader', 'page-outsider')",
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, id_slug, name, is_active, created_at, updated_at)
    VALUES (9201, 'pages-one', 'Pages One', 1, '2026-09-05', '2026-09-05'),
           (9202, 'pages-two', 'Pages Two', 1, '2026-09-05', '2026-09-05')`,
  ).run();
  for (const id of ["page-owner", "page-reader", "page-outsider"]) {
    await env.DB.prepare(
      `INSERT INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, 'savia:test', ?, ?, ?, 1, '2026-09-05', '2026-09-05')`,
    )
      .bind(id, id, `${id}@savia.test`, id)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO identity_tenant_membership (
    id, principal_id, tenant_id, role, is_active, created_at, updated_at
  ) VALUES ('membership-owner', 'page-owner', 9201, 'viewer', 1, '2026-09-05', '2026-09-05'),
           ('membership-reader', 'page-reader', 9201, 'viewer', 1, '2026-09-05', '2026-09-05'),
           ('membership-outsider', 'page-outsider', 9202, 'viewer', 1, '2026-09-05', '2026-09-05')`,
  ).run();
}

describe("Pages API", () => {
  beforeAll(applyMigrations);
  beforeEach(seed);

  it("creates a private root and nested page and rejects stale document saves", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Notes" }),
    });
    expect(created.status).toBe(201);
    const root = ((await created.json()) as any).data;
    expect(root).toMatchObject({ title: "Notes", version: 1, role: "owner" });

    const child = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Child", parentId: root.id }),
    });
    expect(child.status).toBe(201);
    const childDoc = ((await child.json()) as any).data;
    expect(childDoc.parentId).toBe(root.id);

    const moved = await app.request(`/v1/pages/${childDoc.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Moved",
        version: 1,
        parentId: null,
        content: [],
      }),
    });
    expect(moved.status).toBe(400);

    const save = await app.request(`/v1/pages/${root.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Updated",
        version: 1,
        content: [{ type: "p", children: [{ text: "hello" }] }],
      }),
    });
    expect(save.status).toBe(200);
    expect(((await save.json()) as any).data.version).toBe(2);

    const stale = await app.request(`/v1/pages/${root.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Lost update", version: 1, content: [] }),
    });
    expect(stale.status).toBe(409);
  });

  it("returns bounded literal-match excerpts only for authorized queried pages", async () => {
    const searchText = `${"earlier text ".repeat(80)}Literal [needle]%_\\ match ${"later text ".repeat(80)}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
         VALUES('page-excerpt-match',9201,'page-owner',NULL,'page-excerpt-match','Excerpt','page','[]',?,NULL,1,1,'2026-10-03','2026-10-03')`,
      ).bind(searchText),
      env.DB.prepare(
        `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
         VALUES('page-excerpt-private',9201,'page-outsider',NULL,'page-excerpt-private','Private','page','[]',?,NULL,1,1,'2026-10-03','2026-10-03')`,
      ).bind(searchText),
      env.DB.prepare(
        `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
         VALUES('page-excerpt-title-match',9201,'page-owner',NULL,'page-excerpt-title-match','Title-only clue','page','[]','Body text has no title terms',NULL,1,1,'2026-10-03','2026-10-03')`,
      ),
    ]);
    const app = appFor(actor("page-owner", 9201));
    const query = encodeURIComponent("[needle]%_\\");
    const search = (await app
      .request(`/v1/pages?q=${query}`)
      .then((r) => r.json())) as any;

    expect(search.data).toHaveLength(1);
    expect(search.data[0].id).toBe("page-excerpt-match");
    expect(search.data[0].excerpt).toContain("Literal [needle]%_\\ match");
    expect(search.data[0].excerpt.length).toBeLessThanOrEqual(360);
    expect(search.data[0].excerpt.indexOf("[needle]")).toBeLessThanOrEqual(61);

    const unfiltered = (await app
      .request("/v1/pages")
      .then((r) => r.json())) as any;
    expect(
      unfiltered.data.find((page: any) => page.id === "page-excerpt-match"),
    ).not.toHaveProperty("excerpt");
    expect(
      unfiltered.data.some((page: any) => page.id === "page-excerpt-private"),
    ).toBe(false);

    const titleSearch = (await app
      .request("/v1/pages?q=Title-only%20clue")
      .then((r) => r.json())) as any;
    expect(titleSearch.data[0]).toMatchObject({
      id: "page-excerpt-title-match",
      excerpt: "Body text has no title terms",
    });
  });

  it("resolves a record-bound page beyond the first 200 entries and serializes concurrent requests", async () => {
    const binding = {
      domain: "/v1/studio/1",
      collection: "tasks",
      recordId: "task-older-than-page-window",
    };
    const fillerPages = Array.from({ length: 200 }, (_, index) => {
      const id = `page-filler-${index}`;
      return env.DB.prepare(
        `INSERT INTO pages (id,tenant_id,owner_id,root_id,title,content_json,search_text,binding_json,version,share_version,created_at,updated_at,kind)
         VALUES (?,9201,'page-owner',?,'Filler','[]','',NULL,1,1,?,?,'page')`,
      ).bind(
        id,
        id,
        `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
        `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
      );
    });
    await env.DB.batch(fillerPages);
    await env.DB.prepare(
      `INSERT INTO pages (id,tenant_id,owner_id,root_id,title,content_json,search_text,binding_json,version,share_version,created_at,updated_at,kind)
       VALUES ('page-hidden-binding',9201,'page-owner','page-hidden-binding','Existing record page','[]','',?,1,1,'2020-01-01','2020-01-01','page')`,
    )
      .bind(JSON.stringify(binding))
      .run();

    const app = appFor(actor("page-owner", 9201));
    const list = (await app
      .request("/v1/pages")
      .then((response) => response.json())) as any;
    expect(list.data).toHaveLength(200);
    expect(
      list.data.some((page: any) => page.id === "page-hidden-binding"),
    ).toBe(false);

    const request = () =>
      app.request("/v1/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "tasks · task-older-than-page-window",
          binding,
        }),
      });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const ids = await Promise.all(
      responses.map(
        async (response) => ((await response.json()) as any).data.id,
      ),
    );
    expect(ids).toEqual(["page-hidden-binding", "page-hidden-binding"]);
    const matches = await env.DB.prepare(
      "SELECT id FROM pages WHERE tenant_id=9201 AND binding_json=?",
    )
      .bind(JSON.stringify(binding))
      .all<{ id: string }>();
    expect(matches.results).toHaveLength(1);

    const concurrentBinding = {
      ...binding,
      recordId: "task-created-concurrently",
    };
    const createConcurrently = () =>
      app.request("/v1/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Concurrent task",
          binding: concurrentBinding,
        }),
      });
    const concurrentResponses = await Promise.all([
      createConcurrently(),
      createConcurrently(),
    ]);
    expect(concurrentResponses.map((response) => response.status)).toEqual([
      201, 201,
    ]);
    const concurrentIds = await Promise.all(
      concurrentResponses.map(
        async (response) => ((await response.json()) as any).data.id,
      ),
    );
    expect(concurrentIds[0]).toBe(concurrentIds[1]);
  });

  it("preserves duplicate record-page content while migration detaches extra bindings", async () => {
    await env.DB.prepare("DROP INDEX pages_record_binding_unique").run();
    const binding = JSON.stringify({
      domain: "/v1/studio/1",
      collection: "tasks",
      recordId: "legacy-duplicate",
    });
    const contents = [
      JSON.stringify([{ type: "p", children: [{ text: "First note" }] }]),
      JSON.stringify([{ type: "p", children: [{ text: "Second note" }] }]),
    ];
    for (const [index, id] of [
      "legacy-bound-one",
      "legacy-bound-two",
    ].entries())
      await env.DB.prepare(
        `INSERT INTO pages (id,tenant_id,owner_id,root_id,title,content_json,search_text,binding_json,version,share_version,created_at,updated_at,kind)
         VALUES (?,9201,'page-owner',?,? ,?,'',?,1,1,?,?,'page')`,
      )
        .bind(
          id,
          id,
          `Legacy note ${index + 1}`,
          contents[index],
          binding,
          `2020-01-0${index + 1}`,
          `2020-01-0${index + 1}`,
        )
        .run();

    const migration = migrations.find(([path]) =>
      path.endsWith("0013_pages_record_binding_uniqueness.sql"),
    )?.[1];
    expect(migration).toBeDefined();
    for (const statement of migration!
      .split("--> statement-breakpoint")
      .map((entry) =>
        entry
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);

    const legacyPages = await env.DB.prepare(
      "SELECT id,binding_json,content_json FROM pages WHERE id LIKE 'legacy-bound-%' ORDER BY id",
    ).all<{ id: string; binding_json: string | null; content_json: string }>();
    expect(legacyPages.results).toEqual([
      {
        id: "legacy-bound-one",
        binding_json: binding,
        content_json: contents[0],
      },
      { id: "legacy-bound-two", binding_json: null, content_json: contents[1] },
    ]);
  });

  it("creates folders with inherited access and only allows empty folder saves", async () => {
    const ownerApp = appFor(actor("page-owner", 9201));
    const created = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Default page" }),
    });
    expect(((await created.json()) as any).data.kind).toBe("page");

    const folderResponse = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Workspace", kind: "folder" }),
    });
    expect(folderResponse.status).toBe(201);
    const folder = ((await folderResponse.json()) as any).data;
    expect(folder).toMatchObject({
      kind: "folder",
      content: [],
      binding: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT kind,content_json,binding_json FROM pages WHERE id=?",
      )
        .bind(folder.id)
        .first(),
    ).toEqual({ kind: "folder", content_json: "[]", binding_json: null });

    const childResponse = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Inside", parentId: folder.id }),
    });
    const child = ((await childResponse.json()) as any).data;
    expect(child).toMatchObject({
      kind: "page",
      parentId: folder.id,
      rootId: folder.id,
    });

    const nestedFolderResponse = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Nested folder",
        kind: "folder",
        parentId: folder.id,
      }),
    });
    const nestedFolder = ((await nestedFolderResponse.json()) as any).data;
    expect(nestedFolder).toMatchObject({
      kind: "folder",
      parentId: folder.id,
      rootId: folder.id,
    });
    expect(
      (
        (await ownerApp
          .request("/v1/pages")
          .then((response) => response.json())) as any
      ).data.find((item: any) => item.id === folder.id).kind,
    ).toBe("folder");

    const bindingFolder = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Invalid folder",
        kind: "folder",
        binding: {
          domain: "/v1/studio/1",
          collection: "records",
          recordId: "one",
        },
      }),
    });
    expect(bindingFolder.status).toBe(400);

    const renamed = await ownerApp.request(`/v1/pages/${folder.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Renamed workspace",
        version: folder.version,
        content: [],
      }),
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as any).data).toMatchObject({
      kind: "folder",
      title: "Renamed workspace",
    });

    const contentSave = await ownerApp.request(`/v1/pages/${folder.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Has content",
        version: 2,
        content: [{ type: "p", children: [{ text: "not allowed" }] }],
      }),
    });
    expect(contentSave.status).toBe(400);
    expect(((await contentSave.json()) as any).error.code).toBe(
      "FOLDER_CONTENT_NOT_ALLOWED",
    );

    const share = await ownerApp.request(`/v1/pages/${folder.id}/shares`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        shares: [{ principalId: "page-reader", role: "reader" }],
      }),
    });
    expect(share.status).toBe(200);
    const readerApp = appFor(actor("page-reader", 9201));
    expect((await readerApp.request(`/v1/pages/${folder.id}`)).status).toBe(
      200,
    );
    expect((await readerApp.request(`/v1/pages/${child.id}`)).status).toBe(200);

    const deleteNonempty = await ownerApp.request(`/v1/pages/${folder.id}`, {
      method: "DELETE",
    });
    expect(deleteNonempty.status).toBe(409);
    expect(((await deleteNonempty.json()) as any).error.code).toBe(
      "PAGE_HAS_CHILDREN",
    );
  });

  it("shares root content with active same-tenant members, including nested pages, then revokes it", async () => {
    const ownerApp = appFor(actor("page-owner", 9201));
    const created = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Shared" }),
    });
    const root = ((await created.json()) as any).data;
    const childResponse = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Nested", parentId: root.id }),
    });
    const child = ((await childResponse.json()) as any).data;
    const shareResponse = await ownerApp.request(
      `/v1/pages/${root.id}/shares`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          shares: [{ principalId: "page-reader", role: "reader" }],
        }),
      },
    );
    expect(shareResponse.status).toBe(200);

    const updateShares = (role: "reader" | "editor") =>
      ownerApp.request(`/v1/pages/${root.id}/shares`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 2,
          shares: [{ principalId: "page-reader", role }],
        }),
      });
    const concurrentShares = await Promise.all([
      updateShares("reader"),
      updateShares("editor"),
    ]);
    expect(concurrentShares.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const currentShares = (
      (await ownerApp
        .request(`/v1/pages/${root.id}/shares`)
        .then((response) => response.json())) as any
    ).data;
    const winningRole =
      concurrentShares[0].status === 200 ? "reader" : "editor";
    expect(currentShares.shares).toEqual([
      { principalId: "page-reader", role: winningRole },
    ]);
    const promoted = await ownerApp.request(`/v1/pages/${root.id}/shares`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: currentShares.version,
        shares: [{ principalId: "page-reader", role: "editor" }],
      }),
    });
    expect(promoted.status).toBe(200);

    const readerApp = appFor(actor("page-reader", 9201));
    const readChild = await readerApp.request(`/v1/pages/${child.id}`);
    expect(readChild.status).toBe(200);
    expect(((await readChild.json()) as any).data.role).toBe("editor");
    const editAsShared = await readerApp.request(`/v1/pages/${child.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Edited by member",
        version: 1,
        content: [{ type: "p", children: [{ text: "shared edit" }] }],
      }),
    });
    expect(editAsShared.status).toBe(200);
    const outsiderApp = appFor(actor("page-outsider", 9202));
    expect((await outsiderApp.request(`/v1/pages/${root.id}`)).status).toBe(
      404,
    );
    expect((await outsiderApp.request(`/v1/pages?q=Shared`)).status).toBe(200);
    expect(
      (
        (await outsiderApp
          .request(`/v1/pages?q=Shared`)
          .then((response) => response.json())) as any
      ).data,
    ).toHaveLength(0);
    const adminApp = appFor({
      ...actor("page-outsider"),
      globalRoles: ["platform_admin"],
    });
    expect((await adminApp.request(`/v1/pages/${root.id}`)).status).toBe(404);

    const revoke = await ownerApp.request(`/v1/pages/${root.id}/shares`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: currentShares.version + 1, shares: [] }),
    });
    expect(revoke.status).toBe(200);
    expect((await readerApp.request(`/v1/pages/${child.id}`)).status).toBe(404);
  });

  it("rejects shares outside the owner’s active tenant", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Private" }),
    });
    const root = ((await created.json()) as any).data;
    const response = await app.request(`/v1/pages/${root.id}/shares`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        shares: [{ principalId: "page-outsider", role: "editor" }],
      }),
    });
    expect(response.status).toBe(400);
  });

  it("removes an uploaded object if editor access is revoked before file registration", async () => {
    const ownerApp = appFor(actor("page-owner", 9201));
    const created = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Attachments" }),
    });
    const page = ((await created.json()) as any).data;
    const shared = await ownerApp.request(`/v1/pages/${page.id}/shares`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        shares: [{ principalId: "page-reader", role: "editor" }],
      }),
    });
    expect(shared.status).toBe(200);

    const uploadedKeys: string[] = [];
    const deletedKeys: string[] = [];
    const bucket = {
      async put(key: string) {
        uploadedKeys.push(key);
        await env.DB.prepare("DELETE FROM page_shares WHERE root_id=?")
          .bind(page.id)
          .run();
      },
      async delete(key: string) {
        deletedKeys.push(key);
      },
    } as unknown as R2Bucket;
    const readerApp = appFor(actor("page-reader", 9201), bucket);
    const form = new FormData();
    form.append(
      "file",
      new File(["attachment"], "brief.txt", { type: "text/plain" }),
    );
    const response = await readerApp.request(`/v1/pages/${page.id}/files`, {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(404);
    expect(uploadedKeys).toHaveLength(1);
    expect(deletedKeys).toEqual(uploadedKeys);
    const records = await env.DB.prepare(
      "SELECT 1 FROM page_files WHERE page_id=?",
    )
      .bind(page.id)
      .all();
    expect(records.results).toHaveLength(0);
  });

  it("supports page history, restore and same-tenant member lookup", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "History" }),
    });
    const page = ((await created.json()) as any).data;
    const members = await app.request("/v1/pages/members?q=reader");
    expect(members.status).toBe(200);
    expect(((await members.json()) as any).data).toEqual([
      {
        principalId: "page-reader",
        displayName: "page-reader",
        email: "page-reader@savia.test",
      },
    ]);

    await app.request(`/v1/pages/${page.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "New title",
        version: 1,
        content: [{ type: "p", children: [{ text: "new" }] }],
      }),
    });
    const history = await app.request(`/v1/pages/${page.id}/revisions`);
    expect(
      ((await history.json()) as any).data.map((entry: any) => entry.version),
    ).toEqual([2, 1]);
    const restored = await app.request(`/v1/pages/${page.id}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, version: 2 }),
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as any).data).toMatchObject({
      title: "History",
      version: 3,
    });
  });

  it("lets only the owner clear old revisions with a current-version guard", async () => {
    const ownerApp = appFor(actor("page-owner", 9201));
    const created = await ownerApp.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Original" }),
    });
    const page = ((await created.json()) as any).data;
    await ownerApp.request(`/v1/pages/${page.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Current",
        version: 1,
        content: [{ type: "p", children: [{ text: "keep this" }] }],
      }),
    });
    await ownerApp.request(`/v1/pages/${page.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Newest",
        version: 2,
        content: [{ type: "p", children: [{ text: "keep this latest" }] }],
      }),
    });

    const setRole = (role: "reader" | "editor", version: number) =>
      ownerApp.request(`/v1/pages/${page.id}/shares`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version,
          shares: [{ principalId: "page-reader", role }],
        }),
      });
    expect((await setRole("editor", 1)).status).toBe(200);
    const readerApp = appFor(actor("page-reader", 9201));
    expect(
      (
        await readerApp.request(`/v1/pages/${page.id}/revisions?version=3`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect((await setRole("reader", 2)).status).toBe(200);
    expect(
      (
        await readerApp.request(`/v1/pages/${page.id}/revisions?version=3`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    const staleVersion = await ownerApp.request(
      `/v1/pages/${page.id}/revisions?version=2`,
      { method: "DELETE" },
    );
    expect(staleVersion.status).toBe(409);

    const removed = await ownerApp.request(
      `/v1/pages/${page.id}/revisions?version=3`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as any).data).toEqual({ deleted: true });
    const history = await ownerApp.request(`/v1/pages/${page.id}/revisions`);
    expect(
      ((await history.json()) as any).data.map((entry: any) => entry.version),
    ).toEqual([3]);
    const current = await ownerApp.request(`/v1/pages/${page.id}`);
    expect(((await current.json()) as any).data).toMatchObject({
      title: "Newest",
      version: 3,
      content: [{ type: "p", children: [{ text: "keep this latest" }] }],
    });
    expect(
      (await ownerApp.request(`/v1/pages/${page.id}/revisions/3`)).status,
    ).toBe(200);
    expect(
      (await ownerApp.request(`/v1/pages/${page.id}/revisions/1`)).status,
    ).toBe(404);
    expect(
      (await ownerApp.request(`/v1/pages/${page.id}/revisions/2`)).status,
    ).toBe(404);
  });

  it("validates Plate payload size and depth before persisting", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Bounded" }),
    });
    const { id } = ((await created.json()) as any).data;
    const invalid = await app.request(`/v1/pages/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Bounded",
        version: 1,
        content: [{ type: "script", children: [{ text: "x" }] }],
      }),
    });
    expect(invalid.status).toBe(400);
    expect((await app.request(`/v1/pages/${id}`)).status).toBe(200);
  });

  it("accepts editor Plate nodes and canonical issue links while validating text metadata", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Plate" }),
    });
    const { id } = ((await created.json()) as any).data;
    const valid = await app.request(`/v1/pages/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Plate",
        version: 1,
        content: [
          {
            type: "p",
            id: "paragraph-id",
            children: [{ text: "Open ", id: "text-id", bold: true }],
          },
          {
            type: "h2",
            id: "heading-id",
            children: [{ text: "Section" }],
          },
          {
            type: "bullet",
            id: "bullet-id",
            children: [{ text: "Item", italic: true }],
          },
          {
            type: "a",
            id: "link-id",
            url: "mailto:team@example.test",
            children: [{ text: "email" }],
          },
          {
            type: "issue",
            id: "issue-id",
            url: "https://linear.app/acme/issue/ABC-1",
            children: [{ text: "" }],
          },
          {
            type: "collection",
            id: "collection-id",
            domain: "/v1/studio/9201",
            collection: "contacts",
            mode: "table",
            viewId: "view-1",
            children: [{ text: "" }],
          },
          {
            type: "attachment",
            id: "attachment-id",
            fileId: "file-1",
            name: "brief.pdf",
            mimeType: "application/pdf",
            children: [{ text: "" }],
          },
        ],
      }),
    });
    expect(valid.status).toBe(200);
    const saved = ((await valid.json()) as any).data;
    expect(saved.content.map((node: any) => node.type)).toEqual([
      "p",
      "h2",
      "bullet",
      "a",
      "issue",
      "collection",
      "attachment",
    ]);
    expect(saved.content[0]).toMatchObject({
      id: "paragraph-id",
      children: [{ text: "Open ", id: "text-id", bold: true }],
    });
    expect(saved.content[5]).toMatchObject({
      id: "collection-id",
      viewId: "view-1",
    });

    const invalidIssue = await app.request(`/v1/pages/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Plate",
        version: 2,
        content: [
          {
            type: "issue",
            url: "https://example.test/issue/ABC-1",
            children: [{ text: "" }],
          },
        ],
      }),
    });
    expect(invalidIssue.status).toBe(400);
    const invalidMark = await app.request(`/v1/pages/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Plate",
        version: 2,
        content: [{ type: "p", children: [{ text: "bad", bold: "yes" }] }],
      }),
    });
    expect(invalidMark.status).toBe(400);
    const invalidTextId = await app.request(`/v1/pages/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Plate",
        version: 2,
        content: [{ type: "p", children: [{ text: "bad", id: 12 }] }],
      }),
    });
    expect(invalidTextId.status).toBe(400);
    expect(
      ((await app.request(`/v1/pages/${id}`).then((r) => r.json())) as any).data
        .version,
    ).toBe(2);
  });

  it("round trips rich editor blocks and rejects invalid block metadata and structure", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Rich blocks" }),
    });
    const { id } = ((await created.json()) as any).data;
    const content = [
      {
        type: "code_block",
        language: "javascript",
        children: [{ text: "const first = 1;\n\n  return first;  " }],
      },
      { type: "todo", checked: false, children: [{ text: "Unfinished" }] },
      { type: "numbered", children: [{ text: "First item" }] },
      { type: "divider", children: [{ text: "" }] },
      { type: "callout", children: [{ text: "Remember this" }] },
      {
        type: "toggle",
        children: [
          { type: "p", children: [{ text: "Summary" }] },
          { type: "h3", children: [{ text: "Details" }] },
        ],
      },
      {
        type: "table",
        children: [
          {
            type: "table_row",
            children: [
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "A" }] }],
              },
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "B" }] }],
              },
            ],
          },
          {
            type: "table_row",
            children: [
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "C" }] }],
              },
              {
                type: "table_cell",
                children: [{ type: "p", children: [{ text: "D" }] }],
              },
            ],
          },
        ],
      },
    ];
    const saved = await app.request(`/v1/pages/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Rich blocks", version: 1, content }),
    });
    expect(saved.status).toBe(200);
    const document = ((await saved.json()) as any).data;
    expect(document.content).toEqual(content);
    expect(document.content[0].children[0].text).toBe(
      "const first = 1;\n\n  return first;  ",
    );

    const invalidContents = [
      [{ type: "todo", checked: "true", children: [{ text: "Bad state" }] }],
      [
        {
          type: "code_block",
          language: "javascript;alert(1)",
          children: [{ text: "x" }],
        },
      ],
      [{ type: "p", language: "javascript", children: [{ text: "Bad key" }] }],
      [
        {
          type: "table_row",
          children: [
            {
              type: "table_cell",
              children: [{ type: "p", children: [{ text: "Orphan" }] }],
            },
          ],
        },
      ],
      [
        {
          type: "table",
          collapsed: true,
          children: [
            {
              type: "table_row",
              children: [
                {
                  type: "table_cell",
                  children: [{ type: "p", children: [{ text: "A" }] }],
                },
              ],
            },
          ],
        },
      ],
      [
        {
          type: "toggle",
          children: [{ type: "p", children: [{ text: "Summary only" }] }],
        },
      ],
    ];
    for (const invalidContent of invalidContents) {
      const response = await app.request(`/v1/pages/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Rich blocks",
          version: 2,
          content: invalidContent,
        }),
      });
      expect(response.status).toBe(400);
    }
    expect(
      ((await app.request(`/v1/pages/${id}`).then((r) => r.json())) as any).data
        .content,
    ).toEqual(content);
  });

  it("allows only one concurrent document save at a version", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Concurrent" }),
    });
    const { id } = ((await created.json()) as any).data;
    const save = (title: string) =>
      app.request(`/v1/pages/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          version: 1,
          content: [{ type: "p", children: [{ text: title }] }],
        }),
      });
    const responses = await Promise.all([save("First"), save("Second")]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const document = (
      (await app
        .request(`/v1/pages/${id}`)
        .then((response) => response.json())) as any
    ).data;
    expect(document.version).toBe(2);
    expect(["First", "Second"]).toContain(document.title);
    expect(document.content[0].children[0].text).toBe(document.title);
  });

  it("returns its own committed snapshot if another save lands before the response read", async () => {
    const app = appFor(actor("page-owner", 9201));
    const created = await app.request("/v1/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Before" }),
    });
    const { id } = ((await created.json()) as any).data;
    let interleave = true;
    const db = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: async (statements: D1PreparedStatement[]) => {
        const result = await env.DB.batch(statements);
        if (interleave) {
          interleave = false;
          await new PagesService(env.DB, actor("page-owner", 9201)).save(id, {
            title: "Later edit",
            version: 2,
            content: [{ type: "p", children: [{ text: "later" }] }],
          });
        }
        return result;
      },
    } as unknown as D1Database;
    const committed = await new PagesService(
      db,
      actor("page-owner", 9201),
    ).save(id, {
      title: "First edit",
      version: 1,
      content: [{ type: "p", children: [{ text: "first" }] }],
    });
    expect(committed).toMatchObject({
      title: "First edit",
      version: 2,
      content: [{ type: "p", children: [{ text: "first" }] }],
    });
    const current = (
      (await app.request(`/v1/pages/${id}`).then((r) => r.json())) as any
    ).data;
    expect(current).toMatchObject({
      title: "Later edit",
      version: 3,
      content: [{ type: "p", children: [{ text: "later" }] }],
    });
    await expect(
      new PagesService(env.DB, actor("page-owner", 9201)).save(id, {
        title: "Overwrite",
        version: committed.version,
        content: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
