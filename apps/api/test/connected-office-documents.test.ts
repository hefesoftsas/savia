import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerConnectedOfficeDocumentRoutes } from "../src/routes/connected-office-documents";
import { createPersonalIntegrationProviderRegistry } from "../src/personal-integrations/providers";
import type { PersonalIntegrationNangoClient } from "../src/personal-integrations/contracts";
import { createPersonalIntegrationRepository } from "../src/personal-integrations/repository";
import { ConnectedOfficeDocumentsService } from "../src/connected-office-documents/service";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

async function applyMigrations() {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
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

const providerConfiguration = {
  baseUrl: "https://api.nango.dev",
  apiKey: "nango-test-key",
  googleDriveIntegrationId: "google-drive-test",
  oneDrivePersonalIntegrationId: "onedrive-personal-test",
  oneDriveBusinessIntegrationId: "onedrive-business-test",
};

function mockNango(
  responder?: (request: {
    method: string;
    path: string;
    rawBody?: unknown;
    body?: unknown;
    connection: unknown;
  }) => Response,
) {
  const requests: Array<{
    method: string;
    path: string;
    rawBody?: unknown;
    body?: unknown;
    connection: unknown;
  }> = [];
  const nango: PersonalIntegrationNangoClient = {
    async createConnectSession() {
      throw new Error("unused");
    },
    async createReconnectSession() {
      throw new Error("unused");
    },
    async getConnection() {
      throw new Error("unused");
    },
    async deleteConnection() {
      throw new Error("unused");
    },
    async proxy(request) {
      requests.push(request);
      if (responder) return responder(request);
      if (request.method === "POST")
        return Response.json({
          id: "google-file-1",
          name: "Quarterly Plan",
          webViewLink: "https://docs.google.com/document/d/google-file-1/edit",
        });
      return Response.json({
        id: "onedrive-file-1",
        name: "Plan.docx",
        webUrl: "https://onedrive.live.com/edit?id=onedrive-file-1",
        parentReference: { driveId: "drive-1" },
      });
    },
  };
  return { nango, requests };
}

function appFor(
  user: AppActor,
  nango: PersonalIntegrationNangoClient,
  providers = createPersonalIntegrationProviderRegistry(providerConfiguration),
) {
  const app = new OpenAPIHono();
  const auth: Authenticator = {
    async authenticate() {
      return user;
    },
  };
  app.use("*", authenticationMiddleware(env.DB, auth));
  registerConnectedOfficeDocumentRoutes(app, env.DB, { nango, providers });
  return app;
}

async function seed() {
  await env.DB.prepare(
    "DELETE FROM connected_office_document_operations WHERE tenant_id IN (9481,9482)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM personal_integration_audit_events WHERE connection_id IN ('drive-owner','drive-peer','onedrive-owner','business-owner','drive-other')",
  ).run();
  await env.DB.prepare(
    "DELETE FROM personal_integration_connections WHERE principal_id IN ('connected-office-owner','connected-office-peer','connected-office-other')",
  ).run();
  await env.DB.prepare(
    "DELETE FROM office_settings WHERE tenant_id IN (9481,9482)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_tenant_membership WHERE tenant_id IN (9481,9482)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_principal WHERE id IN ('connected-office-owner','connected-office-peer','connected-office-other')",
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES
    (9481,'connected-office-one','Connected Office One',1,'2026-09-05','2026-09-05'),(9482,'connected-office-two','Connected Office Two',1,'2026-09-05','2026-09-05')`,
  ).run();
  for (const id of [
    "connected-office-owner",
    "connected-office-peer",
    "connected-office-other",
  ])
    await env.DB.prepare(
      `INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES (?,'savia:test',?,?,?,1,'2026-09-05','2026-09-05')`,
    )
      .bind(id, id, `${id}@savia.test`, id)
      .run();
  for (const [id, tenant] of [
    ["connected-office-owner", 9481],
    ["connected-office-peer", 9481],
    ["connected-office-other", 9482],
  ] as const)
    await env.DB.prepare(
      `INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES (?,?,?,'viewer',1,'2026-09-05','2026-09-05')`,
    )
      .bind(`membership-${id}`, id, tenant)
      .run();
  await env.DB.prepare(
    `INSERT INTO personal_integration_connections(id,principal_id,provider,nango_connection_id,nango_integration_id,status,external_account_label,scopes,created_at,updated_at)
    VALUES ('drive-owner','connected-office-owner','google_drive','secret-drive-connection','google-drive-test','connected','owner@example.test','[]','2026-09-05','2026-09-05'),
    ('drive-peer','connected-office-peer','google_drive','peer-drive-connection','google-drive-test','connected','peer@example.test','[]','2026-09-05','2026-09-05'),
    ('onedrive-owner','connected-office-owner','onedrive_personal','secret-onedrive-connection','onedrive-personal-test','connected','owner@outlook.test','[]','2026-09-05','2026-09-05'),
    ('business-owner','connected-office-owner','onedrive_business','business-connection','onedrive-business-test','reconnect_required','business@example.test','[]','2026-09-05','2026-09-05'),
    ('drive-other','connected-office-other','google_drive','other-drive-connection','google-drive-test','connected','other@example.test','[]','2026-09-05','2026-09-05')`,
  ).run();
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
    const header = new Uint8Array(30 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(18, entry.body.length, true);
    view.setUint32(22, entry.body.length, true);
    view.setUint16(26, entry.name.length, true);
    header.set(entry.name, 30);
    offset += header.length + entry.body.length;
    return [header, entry.body];
  });
  const central = entries.map((entry) => {
    const header = new Uint8Array(46 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(20, entry.body.length, true);
    view.setUint32(24, entry.body.length, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    header.set(entry.name, 46);
    return header;
  });
  const directorySize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  const parts = [...local.flat(), ...central, end];
  const bytes = new Uint8Array(
    parts.reduce((size, item) => size + item.length, 0),
  );
  let cursor = 0;
  for (const item of parts) {
    bytes.set(item, cursor);
    cursor += item.length;
  }
  return bytes;
}

const json = (response: Response) => response.json() as Promise<any>;

describe("connected office documents", () => {
  beforeAll(applyMigrations);
  beforeEach(seed);

  it("lists only enabled connected providers for the caller and hides server connection credentials", async () => {
    const { nango } = mockNango();
    const response = await appFor(
      actor("connected-office-owner", 9481),
      nango,
    ).request("/v1/connected-office-documents/providers");
    expect(response.status).toBe(200);
    const rawResponse = await response.clone().text();
    expect((await json(response)).data).toEqual([
      {
        provider: "google_drive",
        label: "Google Drive",
        accountLabel: "owner@example.test",
      },
      {
        provider: "onedrive_personal",
        label: "OneDrive Personal",
        accountLabel: "owner@outlook.test",
      },
    ]);
    expect(rawResponse).not.toContain("secret-drive-connection");
  });

  it("creates native Google files once per request id and lists only the owner's private provider links", async () => {
    const { nango, requests } = mockNango();
    const owner = appFor(actor("connected-office-owner", 9481), nango);
    const send = (name = "Quarterly Plan", format = "docx") => {
      const form = new FormData();
      form.set("provider", "google_drive");
      form.set("format", format);
      form.set("name", name);
      form.set("requestId", "bb39f180-83c2-43d5-9a42-9403025215de");
      return owner.request("/v1/connected-office-documents", {
        method: "POST",
        body: form,
      });
    };
    const created = await send();
    expect(created.status).toBe(201);
    const summary = (await json(created)).data;
    expect(summary).toMatchObject({
      name: "Quarterly Plan",
      format: "docx",
      provider: "google_drive",
      url: "https://docs.google.com/document/d/google-file-1/edit",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/drive/v3/files?fields=id,name,webViewLink",
      body: {
        name: "Quarterly Plan",
        mimeType: "application/vnd.google-apps.document",
      },
      connection: expect.objectContaining({
        nangoConnectionId: "secret-drive-connection",
      }),
    });
    expect((await send()).status).toBe(200);
    expect(requests).toHaveLength(1);
    expect((await send("Different title")).status).toBe(409);
    expect((await send("Quarterly Plan", "toString")).status).toBe(400);
    expect(requests).toHaveLength(1);
    expect(
      (await json(await owner.request("/v1/connected-office-documents"))).data,
    ).toEqual([summary]);
    expect(
      (
        await json(
          await appFor(actor("connected-office-peer", 9481), nango).request(
            "/v1/connected-office-documents",
          ),
        )
      ).data,
    ).toEqual([]);
    expect(
      (
        await json(
          await appFor(actor("connected-office-other", 9482), nango).request(
            "/v1/connected-office-documents",
          ),
        )
      ).data,
    ).toEqual([]);
  });

  it("rejects provider writes when the office suite is disabled before any upstream write", async () => {
    const { nango, requests } = mockNango();
    const owner = appFor(actor("connected-office-owner", 9481), nango);
    const googleForm = () => {
      const form = new FormData();
      form.set("provider", "google_drive");
      form.set("format", "pptx");
      form.set("name", "Deck");
      form.set("requestId", crypto.randomUUID());
      return form;
    };
    await env.DB.prepare(
      "INSERT INTO office_settings(tenant_id,platform_allowed,tenant_enabled,updated_at) VALUES (9481,1,0,'2026-09-05')",
    ).run();
    const blocked = await owner.request("/v1/connected-office-documents", {
      method: "POST",
      body: googleForm(),
    });
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).error.code).toBe("OFFICE_SUITE_DISABLED");
    expect(requests).toHaveLength(0);
  });

  it("uploads validated OneDrive template bytes under the requested safe name without overwrite and rejects unsafe editor URLs", async () => {
    const bytes = officeZip("docx");
    const { nango, requests } = mockNango((request) => {
      if (request.method === "PUT")
        return Response.json({
          id: "onedrive-file-1",
          name: "Team Plan.docx",
          webUrl: "https://evil.example/redirect",
          parentReference: { driveId: "drive-1" },
        });
      return Response.json({});
    });
    const owner = appFor(actor("connected-office-owner", 9481), nango);
    const form = new FormData();
    form.set("provider", "onedrive_personal");
    form.set("format", "docx");
    form.set("name", "Team Plan");
    form.set("requestId", "79f7123a-efb3-4b9e-a1e2-73c7cab08a63");
    form.set(
      "file",
      new File([bytes], "template.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const response = await owner.request("/v1/connected-office-documents", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(502);
    expect((await json(response)).error.code).toBe("PROVIDER_URL_UNSAFE");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "PUT",
      path: "/v1.0/me/drive/root:/Team%20Plan.docx:/content?@microsoft.graph.conflictBehavior=fail",
      rawBody: bytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      connection: expect.objectContaining({
        nangoConnectionId: "secret-onedrive-connection",
      }),
    });
  });

  it("persists a successful OneDrive URL and binary upload with the user's chosen filename", async () => {
    const bytes = officeZip("xlsx");
    const { nango, requests } = mockNango((request) =>
      Response.json({
        id: "Opaque OneDrive item id !%/=+",
        name: "Budget.xlsx",
        webUrl: "https://onedrive.live.com/edit?id=onedrive-sheet-1",
        parentReference: { driveId: "drive-private-1" },
      }),
    );
    const owner = appFor(actor("connected-office-owner", 9481), nango);
    const form = new FormData();
    form.set("provider", "onedrive_personal");
    form.set("format", "xlsx");
    form.set("name", "Budget");
    form.set("requestId", "e9a7dfca-c35a-4bf8-b39f-265fa6ab1c70");
    form.set(
      "file",
      new File([bytes], "blank.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const response = await owner.request("/v1/connected-office-documents", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(201);
    expect(
      await env.DB.prepare(
        "SELECT provider_file_id FROM connected_office_document_operations WHERE request_id=?",
      )
        .bind("e9a7dfca-c35a-4bf8-b39f-265fa6ab1c70")
        .first(),
    ).toMatchObject({ provider_file_id: "Opaque OneDrive item id !%/=+" });
    const summary = (await json(response)).data;
    expect(summary).toMatchObject({
      name: "Budget.xlsx",
      format: "xlsx",
      provider: "onedrive_personal",
      url: "https://onedrive.live.com/edit?id=onedrive-sheet-1",
    });
    expect(requests[0]).toMatchObject({
      path: "/v1.0/me/drive/root:/Budget.xlsx:/content?@microsoft.graph.conflictBehavior=fail",
      rawBody: bytes,
    });
    expect(
      (await json(await owner.request("/v1/connected-office-documents"))).data,
    ).toEqual([summary]);
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET status='reconnect_required' WHERE id='onedrive-owner'",
    ).run();
    const nextForm = new FormData();
    nextForm.set("provider", "onedrive_personal");
    nextForm.set("format", "xlsx");
    nextForm.set("name", "Other");
    nextForm.set("requestId", "1a8e2ee3-0506-47b2-90ef-b8692dca191f");
    nextForm.set(
      "file",
      new File([bytes], "blank.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const unavailable = await owner.request("/v1/connected-office-documents", {
      method: "POST",
      body: nextForm,
    });
    expect(unavailable.status).toBe(403);
    expect(requests).toHaveLength(1);
    expect(
      (await json(await owner.request("/v1/connected-office-documents"))).data,
    ).toEqual([summary]);
  });

  it("rejects a changed Nango account before issuing a provider write", async () => {
    const { nango, requests } = mockNango();
    const repository = createPersonalIntegrationRepository(env.DB);
    const lookup = repository.findActiveConnection.bind(repository);
    let lookups = 0;
    vi.spyOn(repository, "findActiveConnection").mockImplementation(
      async (principalId, provider) => {
        if (++lookups === 2)
          await env.DB.prepare(
            "UPDATE personal_integration_connections SET nango_connection_id='replacement-account' WHERE id='drive-owner'",
          ).run();
        return lookup(principalId, provider);
      },
    );
    const service = new ConnectedOfficeDocumentsService(
      env.DB,
      actor("connected-office-owner", 9481),
      createPersonalIntegrationProviderRegistry(providerConfiguration),
      repository,
      nango,
    );
    await expect(
      service.create({
        provider: "google_drive",
        format: "docx",
        name: "Plan",
        requestId: "c716ce70-2bf6-4d61-a260-24ded37281df",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONNECTED" });
    expect(requests).toHaveLength(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM connected_office_document_operations WHERE request_id=?",
      )
        .bind("c716ce70-2bf6-4d61-a260-24ded37281df")
        .first(),
    ).toEqual({ count: 0 });
  });

  it("keeps uncertain upstream outcomes reserved so the same request cannot issue duplicate provider writes", async () => {
    const { nango, requests } = mockNango(() => {
      throw new Error("transport ended before response");
    });
    const owner = appFor(actor("connected-office-owner", 9481), nango);
    const send = () => {
      const form = new FormData();
      form.set("provider", "google_drive");
      form.set("format", "pptx");
      form.set("name", "Deck");
      form.set("requestId", "f0929615-39b0-405f-a890-90af7bebdf85");
      return owner.request("/v1/connected-office-documents", {
        method: "POST",
        body: form,
      });
    };
    const first = await send();
    expect(first.status).toBe(502);
    expect((await json(first)).error.code).toBe("PROVIDER_REQUEST_UNCERTAIN");
    expect((await send()).status).toBe(409);
    expect(requests).toHaveLength(1);
  });

  it("returns saved private links without Nango configuration and rechecks active tenant membership", async () => {
    const { nango } = mockNango();
    const owner = appFor(actor("connected-office-owner", 9481), nango);
    const form = new FormData();
    form.set("provider", "google_drive");
    form.set("format", "docx");
    form.set("name", "Saved");
    form.set("requestId", "216a4456-bbe5-4ef0-ac60-57b45a3bf868");
    const created = await owner.request("/v1/connected-office-documents", {
      method: "POST",
      body: form,
    });
    expect(created.status).toBe(201);
    // The route accepts an absent Nango client while keeping persisted links visible.
    const providersOnly: any = {
      providers: createPersonalIntegrationProviderRegistry(
        providerConfiguration,
      ),
    };
    const app = new OpenAPIHono();
    const auth: Authenticator = {
      async authenticate() {
        return actor("connected-office-owner", 9481);
      },
    };
    app.use("*", authenticationMiddleware(env.DB, auth));
    registerConnectedOfficeDocumentRoutes(app, env.DB, providersOnly);
    expect((await app.request("/v1/connected-office-documents")).status).toBe(
      200,
    );
    expect(
      (
        await json(
          await app.request("/v1/connected-office-documents/providers"),
        )
      ).data,
    ).toEqual([]);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='connected-office-owner' AND tenant_id=9481",
    ).run();
    expect((await app.request("/v1/connected-office-documents")).status).toBe(
      404,
    );
  });
});
