import { describe, expect, it, vi } from "vitest";
import {
  PersonalIntegrationInputError,
  PersonalIntegrationUpstreamError,
} from "../src/personal-integrations/contracts";
import { PersonalIntegrationOperations } from "../src/personal-integrations/operations";

const connection = {
  id: "connection-1",
  principalId: "principal-1",
  provider: "onedrive_business" as const,
  status: "connected" as const,
  externalAccountLabel: "owner@example.test",
  scopes: [],
  lastValidatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nangoConnectionId: "nango-connection-1",
  nangoIntegrationId: "onedrive-business",
  externalAccountId: null,
};

function setup() {
  const repository = {
    findActiveConnection: vi.fn().mockResolvedValue(connection),
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
  const nango = {
    proxy: vi.fn().mockResolvedValue(Response.json({ value: [] })),
  };
  return {
    repository,
    nango,
    operations: new PersonalIntegrationOperations(
      repository as never,
      nango as never,
    ),
  };
}

describe("Microsoft document provider operations", () => {
  it("lists only folders from the bounded root children endpoint", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        value: [
          { id: "folder-1", name: "Policies", folder: { childCount: 3 } },
          {
            id: "file-1",
            name: "policy.pdf",
            file: { mimeType: "application/pdf" },
          },
          { id: "folder-2", name: "Claims", folder: {} },
        ],
      }),
    );

    await expect(
      operations.listDocumentFolders({
        principalId: "principal-1",
        provider: "onedrive_business",
      }),
    ).resolves.toEqual([
      { id: "folder-1", name: "Policies" },
      { id: "folder-2", name: "Claims" },
    ]);
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/v1.0/me/drive/root/children?$top=100&$select=id,name,folder",
        connection: expect.objectContaining({
          nangoConnectionId: "nango-connection-1",
        }),
      }),
    );
  });

  it("lists children of a selected folder using an encoded provider ID", async () => {
    const { operations, nango } = setup();
    await operations.listDocumentFolders({
      principalId: "principal-1",
      provider: "onedrive_personal",
      parentId: "folder id",
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1.0/me/drive/items/folder%20id/children?$top=100&$select=id,name,folder",
      }),
    );
    expect(nango.proxy.mock.calls[0]?.[0].path).not.toContain("folder id");
  });

  it("follows same-collection Graph paging and includes folders from later pages", async () => {
    const { operations, nango } = setup();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({
          value: [{ id: "file-1", name: "policy.pdf", file: {} }],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$select=id%2Cname%2Cfolder&$skiptoken=page-two",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          value: [{ id: "folder-2", name: "Claims", folder: {} }],
        }),
      );

    await expect(
      operations.listDocumentFolders({
        principalId: "principal-1",
        provider: "onedrive_business",
      }),
    ).resolves.toEqual([{ id: "folder-2", name: "Claims" }]);
    expect(nango.proxy).toHaveBeenCalledTimes(2);
    expect(nango.proxy.mock.calls[1]?.[0].path).toBe(
      "/v1.0/me/drive/root/children?$top=100&$select=id%2Cname%2Cfolder&$skiptoken=page-two",
    );
  });

  it.each([
    "https://attacker.example/v1.0/me/drive/root/children?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=x",
    "http://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=x&$filter=name%20ne%20null",
  ])("rejects an unsafe Graph nextLink: %s", async (nextLink) => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(
      Response.json({ value: [], "@odata.nextLink": nextLink }),
    );
    await expect(
      operations.listDocumentFolders({
        principalId: "principal-1",
        provider: "onedrive_business",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationUpstreamError);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("fails explicitly when a folder listing exceeds its page limit", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockImplementation(async (_request: { path: string }) => {
      const page = Number(
        new URLSearchParams(_request.path.split("?")[1]).get("$skiptoken") ??
          "1",
      );
      return Response.json({
        value: [],
        "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100&$select=id%2Cname%2Cfolder&$skiptoken=${page + 1}`,
      });
    });

    await expect(
      operations.listDocumentFolders({
        principalId: "principal-1",
        provider: "onedrive_business",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationUpstreamError);
    expect(nango.proxy).toHaveBeenCalledTimes(10);
  });

  it("fails explicitly for a malformed page instead of returning an incomplete listing", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=next",
      }),
    );

    await expect(
      operations.listDocumentFolders({
        principalId: "principal-1",
        provider: "onedrive_business",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationUpstreamError);
  });

  it("creates a file in the requested folder with the original bytes and fail-on-conflict behavior", async () => {
    const { operations, nango, repository } = setup();
    const content = new Uint8Array([0, 255, 17, 128]);
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        id: "created-file",
        name: "report.bin",
        webUrl: "https://onedrive.example.test/report.bin",
      }),
    );

    await expect(
      operations.saveDocumentCopy({
        principalId: "principal-1",
        provider: "onedrive_business",
        expectedConnectionKey: "connection-1:2026-01-01T00:00:00.000Z",
        folderId: "folder-1",
        name: "report.bin",
        mimeType: "application/octet-stream",
        content,
      }),
    ).resolves.toEqual({
      id: "created-file",
      name: "report.bin",
      webUrl: "https://onedrive.example.test/report.bin",
    });
    const request = nango.proxy.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      method: "PUT",
      path: "/v1.0/me/drive/items/folder-1:/report.bin:/content?%40microsoft.graph.conflictBehavior=fail",
      contentType: "application/octet-stream",
      connection: expect.objectContaining({ principalId: "principal-1" }),
    });
    expect(request).not.toHaveProperty("upstreamHeaders");
    expect(request.rawBody).toBeInstanceOf(Uint8Array);
    expect([...request.rawBody]).toEqual([...content]);
    expect(repository.appendAuditEvent).toHaveBeenCalledWith({
      connection,
      eventType: "upload-file",
      outcome: "succeeded",
    });
  });

  it("creates a root file without allowing path syntax in its name", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(
      Response.json({ id: "root-file", name: "renewal.txt" }),
    );
    await operations.saveDocumentCopy({
      principalId: "principal-1",
      provider: "onedrive_personal",
      name: "renewal.txt",
      mimeType: "text/plain",
      content: new TextEncoder().encode("copy"),
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1.0/me/drive/root:/renewal.txt:/content?%40microsoft.graph.conflictBehavior=fail",
        rawBody: expect.any(Uint8Array),
      }),
    );
    await expect(
      operations.saveDocumentCopy({
        principalId: "principal-1",
        provider: "onedrive_personal",
        name: "../escape.txt",
        mimeType: "text/plain",
        content: new Uint8Array(),
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
  });

  it("rejects a stale reviewed connection key before saving or sending", async () => {
    const { operations, nango, repository } = setup();
    const staleConnectionKey = "connection-1:stale-validation";

    await expect(
      operations.saveDocumentCopy({
        principalId: "principal-1",
        provider: "onedrive_business",
        expectedConnectionKey: staleConnectionKey,
        name: "copy.txt",
        mimeType: "text/plain",
        content: new TextEncoder().encode("copy"),
      }),
    ).rejects.toThrow("connection has changed");
    await expect(
      operations.sendDocumentEmail({
        principalId: "principal-1",
        expectedConnectionKey: staleConnectionKey,
        to: ["recipient@example.test"],
        subject: "Copy",
        body: "Attached.",
        file: {
          name: "copy.txt",
          mimeType: "text/plain",
          content: new TextEncoder().encode("copy"),
        },
      }),
    ).rejects.toThrow("connection has changed");

    expect(repository.findActiveConnection).toHaveBeenCalledTimes(2);
    expect(nango.proxy).not.toHaveBeenCalled();
    expect(repository.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects document copies larger than five MiB before calling the provider", async () => {
    const { operations, nango } = setup();
    await expect(
      operations.saveDocumentCopy({
        principalId: "principal-1",
        provider: "onedrive_business",
        name: "large.bin",
        mimeType: "application/octet-stream",
        content: new Uint8Array(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("reports an existing-name conflict as a failed create-only upload", async () => {
    const { operations, nango, repository } = setup();
    nango.proxy.mockResolvedValueOnce(
      Response.json(
        { error: { code: "nameAlreadyExists" } },
        { status: 409 },
      ),
    );

    await expect(
      operations.saveDocumentCopy({
        principalId: "principal-1",
        provider: "onedrive_business",
        name: "existing.txt",
        mimeType: "text/plain",
        content: new TextEncoder().encode("new copy"),
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationUpstreamError);
    expect(nango.proxy.mock.calls[0]?.[0].path).toContain(
      "%40microsoft.graph.conflictBehavior=fail",
    );
    expect(nango.proxy.mock.calls[0]?.[0]).not.toHaveProperty("upstreamHeaders");
    expect(repository.appendAuditEvent).toHaveBeenCalledWith({
      connection,
      eventType: "upload-file",
      outcome: "failed",
      errorCode: "UPSTREAM_REJECTED",
    });
  });

  it("sends an Outlook attachment as base64 while auditing no message content", async () => {
    const { operations, nango, repository } = setup();
    const content = new Uint8Array([0, 255, 1]);
    await operations.sendDocumentEmail({
      principalId: "principal-1",
      to: [" Recipient@example.test "],
      subject: "Policy copy",
      body: "Attached.",
      file: {
        name: "policy.bin",
        mimeType: "application/octet-stream",
        content,
      },
    });

    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1.0/me/sendMail",
        connection: expect.objectContaining({ principalId: "principal-1" }),
        body: {
          message: {
            subject: "Policy copy",
            body: { contentType: "Text", content: "Attached." },
            toRecipients: [
              { emailAddress: { address: "recipient@example.test" } },
            ],
            attachments: [
              {
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: "policy.bin",
                contentType: "application/octet-stream",
                contentBytes: "AP8B",
              },
            ],
          },
          saveToSentItems: true,
        },
      }),
    );
    expect(repository.appendAuditEvent).toHaveBeenCalledWith({
      connection,
      eventType: "send-email",
      outcome: "succeeded",
    });
    expect(
      JSON.stringify(repository.appendAuditEvent.mock.calls),
    ).not.toContain("Attached.");
  });

  it("rejects mail attachments above two MiB before sending", async () => {
    const { operations, nango } = setup();
    await expect(
      operations.sendDocumentEmail({
        principalId: "principal-1",
        to: ["recipient@example.test"],
        subject: "Copy",
        body: "Attached.",
        file: {
          name: "large.bin",
          mimeType: "application/octet-stream",
          content: new Uint8Array(2 * 1024 * 1024 + 1),
        },
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("rejects unsafe IDs, invalid recipients, and names before provider calls", async () => {
    const { operations, nango } = setup();
    await expect(
      operations.listDocumentFolders({
        principalId: "principal-1",
        provider: "google_drive" as never,
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
    await expect(
      operations.listDocumentFolders({
        principalId: "principal-1",
        provider: "onedrive_business",
        parentId: "..",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
    await expect(
      operations.sendDocumentEmail({
        principalId: "principal-1",
        to: ["not-an-email"],
        subject: "Copy",
        body: "Attached.",
        file: {
          name: "../bad.txt",
          mimeType: "text/plain",
          content: new Uint8Array(),
        },
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("turns provider failures into upstream errors and records a content-free failure audit", async () => {
    const { operations, nango, repository } = setup();
    nango.proxy.mockResolvedValueOnce(
      new Response("provider down", { status: 503 }),
    );
    await expect(
      operations.saveDocumentCopy({
        principalId: "principal-1",
        provider: "onedrive_business",
        name: "copy.txt",
        mimeType: "text/plain",
        content: new TextEncoder().encode("private contents"),
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationUpstreamError);
    expect(repository.appendAuditEvent).toHaveBeenCalledWith({
      connection,
      eventType: "upload-file",
      outcome: "failed",
      errorCode: "UPSTREAM_REJECTED",
    });
    expect(
      JSON.stringify(repository.appendAuditEvent.mock.calls),
    ).not.toContain("private contents");
  });
});
