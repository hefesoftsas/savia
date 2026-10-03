import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import { OfficeDocumentsService } from "../src/office-documents/service";
import { registerOfficeDocumentRoutes } from "../src/routes/office-documents";

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

function officeZip(format: "docx" | "xlsx" | "pptx") {
  const part = {
    docx: "word/document.xml",
    xlsx: "xl/workbook.xml",
    pptx: "ppt/presentation.xml",
  }[format];
  const entries = ["[Content_Types].xml", part].map((name) => ({
    name: new TextEncoder().encode(name),
    body: new TextEncoder().encode("<x/>"),
    offset: 0,
  }));
  let offset = 0;
  const local = entries.map((entry) => {
    entry.offset = offset;
    const head = new Uint8Array(30 + entry.name.length);
    const view = new DataView(head.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(18, entry.body.length, true);
    view.setUint32(22, entry.body.length, true);
    view.setUint16(26, entry.name.length, true);
    head.set(entry.name, 30);
    offset += head.length + entry.body.length;
    return [head, entry.body];
  });
  const central = entries.map((entry) => {
    const head = new Uint8Array(46 + entry.name.length);
    const view = new DataView(head.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(20, entry.body.length, true);
    view.setUint32(24, entry.body.length, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    head.set(entry.name, 46);
    return head;
  });
  const directory = central.reduce((sum, value) => sum + value.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, directory, true);
  view.setUint32(16, offset, true);
  const parts = [...local.flat(), ...central, end];
  const zip = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let cursor = 0;
  for (const part of parts) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  return zip;
}

const actor = (id: string, tenantId: number): AppActor => ({
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

function appFor(user: AppActor, bucket: R2Bucket = env.DOCUMENTS) {
  const app = new OpenAPIHono();
  const auth: Authenticator = {
    async authenticate() {
      return user;
    },
  };
  app.use("*", authenticationMiddleware(env.DB, auth));
  registerOfficeDocumentRoutes(app, env.DB, bucket);
  return app;
}

async function seed() {
  const stored = await env.DOCUMENTS.list({ prefix: "9461/office-owner/" });
  await Promise.all(
    stored.objects.map((object) => env.DOCUMENTS.delete(object.key)),
  );
  const peerStored = await env.DOCUMENTS.list({ prefix: "9461/office-peer/" });
  await Promise.all(
    peerStored.objects.map((object) => env.DOCUMENTS.delete(object.key)),
  );
  await env.DB.prepare(
    "DELETE FROM office_settings WHERE tenant_id IN (9461,9462)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM office_documents WHERE tenant_id IN (9461,9462)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_tenant_membership WHERE tenant_id IN (0,9461,9462)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_principal WHERE id IN ('office-owner','office-peer','office-other')",
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id,id_slug,name,is_active,created_at,updated_at) VALUES
    (9461,'office-one','Office One',1,'2026-09-05','2026-09-05'),(9462,'office-two','Office Two',1,'2026-09-05','2026-09-05')`,
  ).run();
  for (const id of ["office-owner", "office-peer", "office-other"]) {
    await env.DB.prepare(
      `INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at)
      VALUES (?,'savia:test',?,?,?,1,'2026-09-05','2026-09-05')`,
    )
      .bind(id, id, `${id}@savia.test`, id)
      .run();
  }
  for (const [id, tenant] of [
    ["office-owner", 9461],
    ["office-peer", 9461],
    ["office-other", 9462],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
      VALUES (?,?,?,'viewer',1,'2026-09-05','2026-09-05')`,
    )
      .bind(`membership-${id}`, id, tenant)
      .run();
  }
}

async function createDoc(app: OpenAPIHono, name = "Plan.docx"): Promise<any> {
  const form = new FormData();
  form.set(
    "file",
    new File([officeZip("docx")], name, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  const response = await app.request("/v1/office-documents", {
    method: "POST",
    body: form,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as any).data;
}

async function setShare(
  app: OpenAPIHono,
  id: string,
  version: number,
  shares: Array<{ principalId: string; role: "reader" | "editor" }>,
) {
  return app.request(`/v1/office-documents/${id}/shares`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, shares }),
  });
}

async function saveDoc(app: OpenAPIHono, id: string, version: number) {
  const form = new FormData();
  form.set("version", String(version));
  form.set(
    "file",
    new File([officeZip("docx")], "Plan.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  return app.request(`/v1/office-documents/api/file/${id}/revisions`, {
    method: "POST",
    body: form,
  });
}

describe("private office document API", () => {
  beforeAll(applyMigrations);
  beforeEach(seed);

  it("shares documents with active tenant members using reader and editor roles", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const reader = appFor(actor("office-peer", 9461));
    const created = await createDoc(owner);
    const id = created.id as string;

    const members = await owner.request(
      "/v1/office-documents/members?q=office",
    );
    expect(members.status).toBe(200);
    expect(((await members.json()) as any).data).toEqual([
      {
        principalId: "office-peer",
        displayName: "office-peer",
        email: "office-peer@savia.test",
      },
    ]);

    const readerShare = await setShare(owner, id, 1, [
      { principalId: "office-peer", role: "reader" },
    ]);
    expect(readerShare.status).toBe(200);
    const readerShareBody = ((await readerShare.json()) as any).data;
    expect(readerShareBody).toEqual({
      version: 2,
      shares: [
        {
          principalId: "office-peer",
          role: "reader",
          displayName: "office-peer",
          email: "office-peer@savia.test",
        },
      ],
    });
    const shares = await owner.request(`/v1/office-documents/${id}/shares`);
    expect(((await shares.json()) as any).data).toEqual(readerShareBody);

    const ownerList = (
      (await owner
        .request("/v1/office-documents")
        .then((response) => response.json())) as any
    ).data;
    expect(ownerList[0]).toMatchObject({
      id,
      role: "owner",
      ownerName: "office-owner",
    });
    const readerList = (
      (await reader
        .request("/v1/office-documents")
        .then((response) => response.json())) as any
    ).data;
    expect(readerList).toEqual([
      expect.objectContaining({
        id,
        role: "reader",
        ownerName: "office-owner",
      }),
    ]);
    const metadata = await reader.request(
      `/v1/office-documents/api/file/${id}/office`,
    );
    expect(((await metadata.json()) as any).data).toMatchObject({
      role: "reader",
      ownerName: "office-owner",
      readOnly: true,
    });
    expect(
      (
        await reader.request(
          `/v1/office-documents/api/file/${id}/revisions/1/download`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await reader.request(`/v1/office-documents/api/file/${id}/revisions`))
        .status,
    ).toBe(200);
    const readerSave = await saveDoc(reader, id, 1);
    expect(readerSave.status).toBe(403);
    expect(
      (
        await reader.request(`/v1/office-documents/${id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 1 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await owner.request(`/v1/office-documents/${id}/shares`)).status,
    ).toBe(200);

    const editorShare = await setShare(owner, id, 2, [
      { principalId: "office-peer", role: "editor" },
    ]);
    expect(editorShare.status).toBe(200);
    const editorSave = await saveDoc(reader, id, 1);
    expect(editorSave.status).toBe(201);
    const staleSave = await saveDoc(reader, id, 1);
    expect(staleSave.status).toBe(409);
    expect(((await editorSave.json()) as any).data).toMatchObject({
      role: "editor",
      ownerName: "office-owner",
      version: 2,
    });
    const revision = await env.DB.prepare(
      "SELECT storage_key,created_by FROM office_document_revisions WHERE document_id=? AND version=2",
    )
      .bind(id)
      .first<{ storage_key: string; created_by: string }>();
    expect(revision).toMatchObject({ created_by: "office-peer" });
    expect(revision!.storage_key).toContain("9461/office-owner/");
    expect(
      (
        await reader.request(`/v1/office-documents/${id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 2 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await reader.request(`/v1/office-documents/${id}/shares`)).status,
    ).toBe(404);

    const deleted = await owner.request(`/v1/office-documents/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2 }),
    });
    expect(deleted.status).toBe(204);
  });

  it("rejects stale share versions, duplicate and inactive or cross-tenant recipients", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const created = await createDoc(owner);

    const duplicate = await setShare(owner, created.id, 1, [
      { principalId: "office-peer", role: "reader" },
      { principalId: "office-peer", role: "editor" },
    ]);
    expect(duplicate.status).toBe(400);
    const otherTenant = await setShare(owner, created.id, 1, [
      { principalId: "office-other", role: "reader" },
    ]);
    expect(otherTenant.status).toBe(400);
    const selfShare = await setShare(owner, created.id, 1, [
      { principalId: "office-owner", role: "reader" },
    ]);
    expect(selfShare.status).toBe(400);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='office-peer' AND tenant_id=9461",
    ).run();
    const inactive = await setShare(owner, created.id, 1, [
      { principalId: "office-peer", role: "reader" },
    ]);
    expect(inactive.status).toBe(400);

    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id='office-peer' AND tenant_id=9461",
    ).run();
    const granted = await setShare(owner, created.id, 1, [
      { principalId: "office-peer", role: "reader" },
    ]);
    expect(granted.status).toBe(200);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='office-peer' AND tenant_id=9461",
    ).run();
    expect(
      (
        (await owner
          .request(`/v1/office-documents/${created.id}/shares`)
          .then((response) => response.json())) as any
      ).data.shares,
    ).toEqual([
      {
        principalId: "office-peer",
        role: "reader",
        displayName: "office-peer",
        email: "office-peer@savia.test",
      },
    ]);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id='office-peer' AND tenant_id=9461",
    ).run();
    const stale = await setShare(owner, created.id, 1, []);
    expect(stale.status).toBe(409);
    expect(
      (await appFor(actor("office-peer", 9461)).request("/v1/office-documents"))
        .status,
    ).toBe(200);
    const revoked = await setShare(owner, created.id, 2, []);
    expect(revoked.status).toBe(200);
    const peer = appFor(actor("office-peer", 9461));
    expect(
      (
        (await peer
          .request("/v1/office-documents")
          .then((response) => response.json())) as any
      ).data,
    ).toEqual([]);
    expect(
      (await peer.request(`/v1/office-documents/api/file/${created.id}/office`))
        .status,
    ).toBe(404);
  });

  it.each(["deleted", "membership revoked", "suite disabled"])(
    "preserves scoped errors when sharing races with %s",
    async (change) => {
      const user = actor("office-owner", 9461);
      const created = await createDoc(appFor(user));
      const db = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (change === "deleted")
                await target
                  .prepare("DELETE FROM office_documents WHERE id=?")
                  .bind(created.id)
                  .run();
              else if (change === "membership revoked")
                await target
                  .prepare(
                    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='office-owner' AND tenant_id=9461",
                  )
                  .run();
              else
                await target
                  .prepare(
                    "INSERT INTO office_settings(tenant_id,platform_allowed,tenant_enabled,updated_at) VALUES(9461,1,0,'2026-10-03')",
                  )
                  .run();
              return target.batch(statements);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as D1Database;
      const service = new OfficeDocumentsService(db, user, env.DOCUMENTS);
      await expect(
        service.setShares(created.id, { version: 1, shares: [] }),
      ).rejects.toMatchObject({
        status: change === "suite disabled" ? 403 : 404,
      });
    },
  );

  it("does not commit a save whose editor grant is revoked while its upload is pending", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const created = await createDoc(owner);
    const granted = await setShare(owner, created.id, 1, [
      { principalId: "office-peer", role: "editor" },
    ]);
    expect(granted.status).toBe(200);

    let started!: () => void;
    let release!: () => void;
    const putStarted = new Promise<void>((resolve) => (started = resolve));
    const putGate = new Promise<void>((resolve) => (release = resolve));
    const delayedBucket = new Proxy(env.DOCUMENTS, {
      get(target, property, receiver) {
        if (property === "put")
          return async (...args: Parameters<R2Bucket["put"]>) => {
            started();
            await putGate;
            return Reflect.get(target, property, receiver).apply(target, args);
          };
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const editor = appFor(actor("office-peer", 9461), delayedBucket);
    const pendingSave = saveDoc(editor, created.id, 1);
    await putStarted;
    const revoked = await setShare(owner, created.id, 2, []);
    expect(revoked.status).toBe(200);
    release();
    const save = await pendingSave;
    expect(save.status).toBe(404);
    const current = await env.DB.prepare(
      "SELECT version FROM office_documents WHERE id=?",
    )
      .bind(created.id)
      .first<{ version: number }>();
    expect(current).toEqual({ version: 1 });
    expect(
      await env.DB.prepare(
        "SELECT 1 FROM office_document_revisions WHERE document_id=? AND version=2",
      )
        .bind(created.id)
        .first(),
    ).toBeNull();
  });

  it("requires explicit tenant zero membership for tenant zero document shares", async () => {
    const ownerActor = actor("office-owner", 0);
    await env.DB.prepare(
      "DELETE FROM identity_tenant_membership WHERE principal_id='office-owner'",
    ).run();
    await env.DB.prepare(
      `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
       VALUES ('membership-office-owner-zero','office-owner',0,'viewer',1,'2026-09-05','2026-09-05')`,
    ).run();
    ownerActor.memberships = [
      {
        id: "membership-office-owner-zero",
        principalId: "office-owner",
        agencyId: 0,
        tenantId: 0,
        role: "viewer",
        isActive: true,
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
    ];
    const owner = appFor(ownerActor);
    const created = await createDoc(owner);

    expect(
      (
        await setShare(owner, created.id, 1, [
          { principalId: "office-peer", role: "reader" },
        ])
      ).status,
    ).toBe(400);
    await env.DB.prepare(
      "DELETE FROM identity_tenant_membership WHERE principal_id='office-peer'",
    ).run();
    await env.DB.prepare(
      `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at)
       VALUES ('membership-office-peer-zero','office-peer',0,'viewer',1,'2026-09-05','2026-09-05')`,
    ).run();
    const granted = await setShare(owner, created.id, 1, [
      { principalId: "office-peer", role: "reader" },
    ]);
    expect(granted.status).toBe(200);
    const reader = appFor(actor("office-peer", 0));
    expect(
      (
        (await reader
          .request("/v1/office-documents")
          .then((response) => response.json())) as any
      ).data,
    ).toEqual([expect.objectContaining({ id: created.id, role: "reader" })]);
  });

  it("stores valid OOXML privately, preserves immutable revisions, and rejects stale writes", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const bytes = officeZip("docx");
    const createForm = new FormData();
    createForm.set(
      "file",
      new File([bytes], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const created = await owner.request("/v1/office-documents", {
      method: "POST",
      body: createForm,
    });
    expect(created.status).toBe(201);
    const summary = ((await created.json()) as any).data;
    expect(summary).toMatchObject({
      name: "Plan.docx",
      version: 1,
      size: bytes.length,
    });

    const metadata = await owner.request(
      `/v1/office-documents/api/file/${summary.id}/office`,
    );
    expect(((await metadata.json()) as any).data).toMatchObject({
      id: summary.id,
      field: null,
      object: null,
      readOnly: false,
      maxSize: 5 * 1024 * 1024,
    });
    const saveForm = new FormData();
    saveForm.set("version", "1");
    saveForm.set(
      "file",
      new File([bytes], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const saved = await owner.request(
      `/v1/office-documents/api/file/${summary.id}/revisions`,
      { method: "POST", body: saveForm },
    );
    expect(saved.status).toBe(201);
    expect(((await saved.json()) as any).data.version).toBe(2);

    const persisted = await env.DB.prepare(
      "SELECT storage_key FROM office_document_revisions WHERE document_id=? ORDER BY version",
    )
      .bind(summary.id)
      .all<{ storage_key: string }>();
    expect(persisted.results).toHaveLength(2);
    for (const revision of persisted.results) {
      const object = await env.DOCUMENTS.get(revision.storage_key);
      expect(object).not.toBeNull();
      expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
    }

    const staleForm = new FormData();
    staleForm.set("version", "1");
    staleForm.set(
      "file",
      new File([bytes], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    expect(
      (
        await owner.request(
          `/v1/office-documents/api/file/${summary.id}/revisions`,
          { method: "POST", body: staleForm },
        )
      ).status,
    ).toBe(409);
    const revisions = await owner.request(
      `/v1/office-documents/api/file/${summary.id}/revisions`,
    );
    expect(
      ((await revisions.json()) as any).data.map(
        (revision: any) => revision.version,
      ),
    ).toEqual([2, 1]);
    const oldDownload = await owner.request(
      `/v1/office-documents/api/file/${summary.id}/revisions/1/download`,
    );
    expect(new Uint8Array(await oldDownload.arrayBuffer())).toEqual(bytes);
    const list = await owner.request("/v1/office-documents");
    expect(((await list.json()) as any).data).toHaveLength(1);

    const reopenedOwner = appFor(actor("office-owner", 9461));
    expect(
      (
        (await (
          await reopenedOwner.request("/v1/office-documents")
        ).json()) as any
      ).data,
    ).toHaveLength(1);
    const reopenedDownload = await reopenedOwner.request(
      `/v1/office-documents/api/file/${summary.id}/revisions/2/download`,
    );
    expect(new Uint8Array(await reopenedDownload.arrayBuffer())).toEqual(bytes);

    const racingSave = (version: number) => {
      const form = new FormData();
      form.set("version", String(version));
      form.set(
        "file",
        new File([bytes], "Plan.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      return owner.request(
        `/v1/office-documents/api/file/${summary.id}/revisions`,
        { method: "POST", body: form },
      );
    };
    const race = await Promise.all([racingSave(2), racingSave(2)]);
    expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
    const finalRevisions = await owner.request(
      `/v1/office-documents/api/file/${summary.id}/revisions`,
    );
    expect(
      ((await finalRevisions.json()) as any).data.map(
        (revision: any) => revision.version,
      ),
    ).toEqual([3, 2, 1]);
    const objects = await env.DOCUMENTS.list({ prefix: "9461/office-owner/" });
    expect(objects.objects).toHaveLength(3);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='office-owner' AND tenant_id=9461",
    ).run();
    expect((await owner.request("/v1/office-documents")).status).toBe(404);
  });

  it("hides another owner's document and rejects malformed Office packages", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const invalid = new FormData();
    invalid.set(
      "file",
      new File(["plain text"], "bad.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    expect(
      (
        await owner.request("/v1/office-documents", {
          method: "POST",
          body: invalid,
        })
      ).status,
    ).toBe(422);
    const form = new FormData();
    form.set(
      "file",
      new File([officeZip("xlsx")], "Budget.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const created = await owner.request("/v1/office-documents", {
      method: "POST",
      body: form,
    });
    const id = ((await created.json()) as any).data.id;
    const peer = appFor(actor("office-peer", 9461));
    expect(
      (await peer.request(`/v1/office-documents/api/file/${id}/office`)).status,
    ).toBe(404);
    expect(
      (
        (await peer
          .request("/v1/office-documents")
          .then((response) => response.json())) as any
      ).data,
    ).toHaveLength(0);
    expect(
      (await peer.request(`/v1/office-documents/api/file/${id}/revisions`))
        .status,
    ).toBe(404);
    expect(
      (
        await peer.request(
          `/v1/office-documents/api/file/${id}/revisions/1/download`,
        )
      ).status,
    ).toBe(404);
    const stolenSave = new FormData();
    stolenSave.set("version", "1");
    stolenSave.set(
      "file",
      new File([officeZip("xlsx")], "Budget.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    expect(
      (
        await peer.request(`/v1/office-documents/api/file/${id}/revisions`, {
          method: "POST",
          body: stolenSave,
        })
      ).status,
    ).toBe(404);
    const revisions = await env.DB.prepare(
      "SELECT version FROM office_document_revisions WHERE document_id=? ORDER BY version",
    )
      .bind(id)
      .all<{ version: number }>();
    expect(revisions.results.map((revision) => revision.version)).toEqual([1]);
  });

  it("deletes an owned document only at the current version and removes its stored revisions", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const form = new FormData();
    const bytes = officeZip("docx");
    form.set(
      "file",
      new File([bytes], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const created = await owner.request("/v1/office-documents", {
      method: "POST",
      body: form,
    });
    const id = ((await created.json()) as any).data.id as string;
    const revisionForm = new FormData();
    revisionForm.set("version", "1");
    revisionForm.set(
      "file",
      new File([bytes], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    expect(
      (
        await owner.request(`/v1/office-documents/api/file/${id}/revisions`, {
          method: "POST",
          body: revisionForm,
        })
      ).status,
    ).toBe(201);
    const stored = await env.DB.prepare(
      "SELECT storage_key FROM office_document_revisions WHERE document_id=?",
    )
      .bind(id)
      .all<{ storage_key: string }>();

    const stale = await owner.request(`/v1/office-documents/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT 1 FROM office_documents WHERE id=?")
        .bind(id)
        .first(),
    ).not.toBeNull();

    const peer = await appFor(actor("office-peer", 9461)).request(
      `/v1/office-documents/${id}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 2 }),
      },
    );
    expect(peer.status).toBe(404);

    const deleted = await owner.request(`/v1/office-documents/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2 }),
    });
    expect(deleted.status).toBe(204);
    expect(
      await env.DB.prepare("SELECT 1 FROM office_documents WHERE id=?")
        .bind(id)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT 1 FROM office_document_revisions WHERE document_id=?",
      )
        .bind(id)
        .first(),
    ).toBeNull();
    for (const revision of stored.results)
      expect(await env.DOCUMENTS.get(revision.storage_key)).toBeNull();
  });

  it("keeps a deleted document inaccessible when revision storage cleanup fails", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const form = new FormData();
    const bytes = officeZip("docx");
    form.set(
      "file",
      new File([bytes], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const created = await owner.request("/v1/office-documents", {
      method: "POST",
      body: form,
    });
    const id = ((await created.json()) as any).data.id as string;
    const revision = await env.DB.prepare(
      "SELECT storage_key FROM office_document_revisions WHERE document_id=?",
    )
      .bind(id)
      .first<{ storage_key: string }>();
    expect(revision).not.toBeNull();

    const unavailableCleanup = new Proxy(env.DOCUMENTS, {
      get(target, property, receiver) {
        if (property === "delete")
          return async () => {
            throw new Error("simulated R2 outage");
          };
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as R2Bucket;
    const deletingOwner = appFor(
      actor("office-owner", 9461),
      unavailableCleanup,
    );
    const deleted = await deletingOwner.request(`/v1/office-documents/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(deleted.status).toBe(204);
    expect(
      (
        await owner.request(
          `/v1/office-documents/api/file/${id}/revisions/1/download`,
        )
      ).status,
    ).toBe(404);
    expect(
      await env.DB.prepare(
        "SELECT 1 FROM office_document_revisions WHERE document_id=?",
      )
        .bind(id)
        .first(),
    ).toBeNull();
    expect(await env.DOCUMENTS.get(revision!.storage_key)).not.toBeNull();
  });

  it("blocks editing while disabled and preserves stored documents for re-enabling", async () => {
    const owner = appFor(actor("office-owner", 9461));
    const form = new FormData();
    form.set(
      "file",
      new File([officeZip("docx")], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const created = await owner.request("/v1/office-documents", {
      method: "POST",
      body: form,
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).data.id;
    await env.DB.prepare(
      "INSERT INTO office_settings(tenant_id,platform_allowed,tenant_enabled,updated_at) VALUES(9461,1,0,'2026-09-05')",
    ).run();

    for (const path of [
      "/v1/office-documents",
      `/v1/office-documents/api/file/${id}/office`,
      `/v1/office-documents/api/file/${id}/revisions`,
      `/v1/office-documents/api/file/${id}/revisions/1/download`,
    ]) {
      const response = await owner.request(path);
      expect(response.status).toBe(403);
      expect(((await response.json()) as any).error.code).toBe(
        "OFFICE_SUITE_DISABLED",
      );
    }
    const saveForm = new FormData();
    saveForm.set("version", "1");
    saveForm.set(
      "file",
      new File([officeZip("docx")], "Plan.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const blockedSave = await owner.request(
      `/v1/office-documents/api/file/${id}/revisions`,
      { method: "POST", body: saveForm },
    );
    expect(blockedSave.status).toBe(403);
    expect(((await blockedSave.json()) as any).error.code).toBe(
      "OFFICE_SUITE_DISABLED",
    );
    const blockedCreateForm = new FormData();
    blockedCreateForm.set(
      "file",
      new File([officeZip("xlsx")], "Budget.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    expect(
      (
        await owner.request("/v1/office-documents", {
          method: "POST",
          body: blockedCreateForm,
        })
      ).status,
    ).toBe(403);

    await env.DB.prepare(
      "UPDATE office_settings SET tenant_enabled=1 WHERE tenant_id=9461",
    ).run();
    const reopenedList = await owner.request("/v1/office-documents");
    expect(
      ((await reopenedList.json()) as any).data.map(
        (document: any) => document.id,
      ),
    ).toEqual([id]);
    expect(
      (
        await owner.request(
          `/v1/office-documents/api/file/${id}/revisions/1/download`,
        )
      ).status,
    ).toBe(200);
  });
});
