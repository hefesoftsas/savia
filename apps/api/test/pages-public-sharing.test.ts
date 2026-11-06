import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerPublicPagesRoutes } from "../src/pages/public-routes";

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

function actor(id: string, tenantId: number): AppActor {
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
  };
}

function appFor(
  user?: AppActor,
  documents?: R2Bucket,
  options: Parameters<typeof registerPublicPagesRoutes>[3] = {},
) {
  const app = new OpenAPIHono();
  if (user) {
    const auth: Authenticator = {
      async authenticate() {
        return user;
      },
    };
    app.use("*", authenticationMiddleware(env.DB, auth));
  }
  registerPublicPagesRoutes(app, env.DB, documents, options);
  return app;
}

async function seed() {
  await env.DB.prepare("DELETE FROM page_public_links").run();
  await env.DB.prepare("DELETE FROM page_files").run();
  await env.DB.prepare("DELETE FROM page_shares").run();
  await env.DB.prepare("DELETE FROM page_revisions").run();
  await env.DB.prepare("DELETE FROM pages").run();
  await env.DB.prepare(
    "DELETE FROM identity_tenant_membership WHERE tenant_id=9211",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_principal WHERE id IN ('public-page-owner','public-page-editor')",
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id,id_slug,name,is_active,created_at,updated_at)
    VALUES (9211,'public-pages','Public Pages',1,'2026-09-05','2026-09-05')`,
  ).run();
  for (const id of ["public-page-owner", "public-page-editor"]) {
    await env.DB.prepare(
      `INSERT INTO identity_principal (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
      VALUES (?,'savia:test',?,?,?,1,'2026-09-05','2026-09-05')`,
    )
      .bind(id, id, `${id}@savia.test`, id)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO identity_tenant_membership (id,principal_id,tenant_id,role,is_active,created_at,updated_at)
    VALUES ('public-page-owner-membership','public-page-owner',9211,'viewer',1,'2026-09-05','2026-09-05'),
           ('public-page-editor-membership','public-page-editor',9211,'viewer',1,'2026-09-05','2026-09-05')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO pages (id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,created_at,updated_at)
    VALUES ('public-root',9211,'public-page-owner',NULL,'public-root','Root','folder','[]','','{"domain":"/v1/studio/9211","collection":"secret","recordId":"private"}','2026-09-05','2026-09-05'),
           ('public-grant',9211,'public-page-owner','public-root','public-root','Selected','page','[{"type":"p","children":[{"text":"shared text"}]}]','','null','2026-09-05','2026-09-05'),
           ('public-child',9211,'public-page-owner','public-grant','public-root','Child','page','[{"type":"p","children":[{"text":"child text"}]}]','','null','2026-09-05','2026-09-05'),
           ('public-private',9211,'public-page-owner',NULL,'public-private','Private','page','[{"type":"p","children":[{"text":"secret"}]}]','','null','2026-09-05','2026-09-05')`,
  ).run();
  await env.DB.prepare(
    "INSERT INTO page_shares (root_id,tenant_id,principal_id,role,created_at) VALUES ('public-root',9211,'public-page-editor','editor','2026-09-05')",
  ).run();
}

async function publish(pageId = "public-grant", expiresAt?: string) {
  const response = await appFor(actor("public-page-owner", 9211)).request(
    `/v1/pages/${pageId}/public-links`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(expiresAt === undefined ? {} : { expiresAt }),
    },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as any).data as { id: string; path: string };
}

describe("public Pages sharing", () => {
  beforeAll(applyMigrations);
  beforeEach(seed);

  it("lets only the owner publish and lists an opaque revocable link", async () => {
    const editor = await appFor(actor("public-page-editor", 9211)).request(
      "/v1/pages/public-grant/public-links",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(editor.status).toBe(404);
    const link = await publish();
    expect(link.path).toMatch(/^\/public\/pages\/[a-f0-9]{64}$/);
    const listed = await appFor(actor("public-page-owner", 9211)).request(
      "/v1/pages/public-grant/public-links",
    );
    expect(((await listed.json()) as any).data).toHaveLength(1);
  });

  it("exposes only the selected page subtree through a safe live projection", async () => {
    const link = await publish();
    const app = appFor();
    const root = await app.request(`/api${link.path}`);
    expect(root.status).toBe(200);
    const body = ((await root.json()) as any).data;
    expect(body.root).toEqual({ id: "public-grant", title: "Selected" });
    expect(body.page.content[0].children[0].text).toBe("shared text");
    expect(body).not.toHaveProperty("page.ownerId");
    expect(body).not.toHaveProperty("page.binding");
    expect(body.children.map((item: any) => item.id)).toEqual(["public-child"]);
    expect(
      (await app.request(`/api${link.path}/pages/public-private`)).status,
    ).toBe(404);
    await env.DB.prepare(
      "UPDATE pages SET owner_id='public-page-editor' WHERE id='public-grant'",
    ).run();
    expect((await app.request(`/api${link.path}`)).status).toBe(404);
  });

  it("hides revoked and expired links and allows their owner to revoke", async () => {
    const expired = await publish();
    await env.DB.prepare(
      "UPDATE page_public_links SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(expired.id)
      .run();
    expect((await appFor().request(`/api${expired.path}`)).status).toBe(404);
    const active = await publish();
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='public-page-owner'",
    ).run();
    expect((await appFor().request(`/api${active.path}`)).status).toBe(404);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id='public-page-owner'",
    ).run();
    const owner = appFor(actor("public-page-owner", 9211));
    const deleted = await owner.request(
      `/v1/pages/public-grant/public-links/${active.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    expect((await appFor().request(`/api${active.path}`)).status).toBe(404);
  });

  it("normalizes offset expiry timestamps before applying lexical expiry checks", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const localOffset = new Date(future.getTime() + 5 * 60 * 60 * 1000)
      .toISOString()
      .replace("Z", "+05:00");
    const link = await publish("public-grant", localOffset);
    const stored = await env.DB.prepare(
      "SELECT expires_at FROM page_public_links WHERE id=?",
    )
      .bind(link.id)
      .first<{ expires_at: string }>();
    expect(stored?.expires_at).toBe(future.toISOString());
    expect((await appFor().request(`/api${link.path}`)).status).toBe(200);
  });

  it("creates reusable short URLs and redirects only while the public link is active", async () => {
    const link = await publish();
    const owner = appFor(actor("public-page-owner", 9211));
    const endpoint = `/v1/pages/public-grant/public-links/${link.id}/short-url`;
    const first = await owner.request(endpoint, { method: "POST" });
    expect(first.status).toBe(200);
    const { data } = (await first.json()) as {
      data: { shortUrl: string };
    };
    expect(data.shortUrl).toMatch(/^http:\/\/localhost\/s\/p\/[a-f0-9]{24}$/);
    const repeat = await owner.request(endpoint, { method: "POST" });
    expect(((await repeat.json()) as any).data.shortUrl).toBe(data.shortUrl);

    const listed = await owner.request("/v1/pages/public-grant/public-links");
    expect(
      ((await listed.json()) as any).data.find((item: any) => item.id === link.id)
        .shortUrl,
    ).toBe(data.shortUrl);
    const redirect = await appFor().request(new URL(data.shortUrl).pathname);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(
      `http://localhost${link.path}`,
    );

    await owner.request(endpoint, { method: "POST" });
    await env.DB.prepare(
      "UPDATE page_public_links SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(link.id)
      .run();
    expect((await appFor().request(new URL(data.shortUrl).pathname)).status).toBe(
      404,
    );
    await env.DB.prepare(
      "UPDATE page_public_links SET expires_at=NULL WHERE id=?",
    )
      .bind(link.id)
      .run();
    await owner.request(`/v1/pages/public-grant/public-links/${link.id}`, {
      method: "DELETE",
    });
    expect((await appFor().request(new URL(data.shortUrl).pathname)).status).toBe(
      404,
    );
    expect((await owner.request(endpoint, { method: "POST" })).status).toBe(
      404,
    );
  });

  it("prefers a configured shortener and persists its URL", async () => {
    const link = await publish();
    const shorten = vi.fn(async () => "https://go.savia.test/abc123");
    const owner = appFor(actor("public-page-owner", 9211), undefined, {
      publicOrigin: "https://savia.test",
      shortener: { shorten },
    });
    const response = await owner.request(
      `/v1/pages/public-grant/public-links/${link.id}/short-url`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(shorten).toHaveBeenCalledWith(`https://savia.test${link.path}`);
    expect(((await response.json()) as any).data.shortUrl).toBe(
      "https://go.savia.test/abc123",
    );
  });

  it("serves only currently referenced attachments and stops serving them after revocation", async () => {
    const link = await publish();
    await env.DB.prepare(
      "UPDATE pages SET content_json=? WHERE id='public-child'",
    )
      .bind(
        JSON.stringify([
          {
            type: "attachment",
            fileId: "public-file",
            name: "photo.png",
            mimeType: "image/png",
            children: [],
          },
        ]),
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO page_files (id,page_id,root_id,tenant_id,storage_key,file_name,mime_type,size,created_at)
      VALUES ('public-file','public-child','public-root',9211,'public-file-key','photo.png','image/png',4,'2026-09-05')`,
    ).run();
    const object = {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        },
      }),
      size: 4,
      writeHttpMetadata() {},
    };
    const documents = {
      async get() {
        return object;
      },
    } as unknown as R2Bucket;
    const app = appFor(undefined, documents);
    const path = `/api${link.path}/pages/public-child/files/public-file`;
    const file = await app.request(path);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("cache-control")).toBe("no-store");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    await env.DB.prepare(
      "UPDATE page_files SET mime_type='image/svg+xml' WHERE id='public-file'",
    ).run();
    expect(
      (await app.request(path)).headers.get("content-disposition"),
    ).toMatch(/^attachment;/);
    expect(
      (await app.request(path.replace("public-file", "unreferenced-file")))
        .status,
    ).toBe(404);
    await appFor(actor("public-page-owner", 9211)).request(
      `/v1/pages/public-grant/public-links/${link.id}`,
      { method: "DELETE" },
    );
    expect((await app.request(path)).status).toBe(404);
  });
});
