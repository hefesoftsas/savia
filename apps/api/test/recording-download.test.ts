import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PersonalIntegrationInputError,
  PersonalIntegrationUnavailableError,
  PersonalIntegrationUpstreamError,
} from "../src/personal-integrations/contracts";
import { PersonalIntegrationOperations } from "../src/personal-integrations/operations";

const connection = {
  id: "connection-1",
  principalId: "principal-1",
  provider: "google_drive" as const,
  status: "connected" as const,
  externalAccountLabel: "owner@example.test",
  scopes: [],
  lastValidatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nangoConnectionId: "nango-connection-1",
  nangoIntegrationId: "google-drive",
  externalAccountId: null,
};

function setup(provider: typeof connection.provider = "google_drive") {
  const ownerConnection = { ...connection, provider };
  const repository = {
    findActiveConnection: vi.fn().mockResolvedValue(ownerConnection),
  };
  const nango = {
    proxy: vi.fn(),
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

function googleMetadata(overrides: Record<string, unknown> = {}) {
  return Response.json({
    id: "file-1",
    name: "meeting.mp3",
    mimeType: "audio/mpeg",
    size: "3",
    ...overrides,
  });
}

describe("recording file downloads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads a Google Drive audio file through fixed metadata and media paths", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(googleMetadata()).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/mpeg", "content-length": "3" },
      }),
    );

    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).resolves.toEqual({
      name: "meeting.mp3",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
    });
    expect(nango.proxy.mock.calls.map(([request]) => request.path)).toEqual([
      "/drive/v3/files/file-1?fields=id%2Cname%2CmimeType%2Csize",
      "/drive/v3/files/file-1?alt=media",
    ]);
  });

  it.each(["onedrive_personal", "onedrive_business"] as const)(
    "downloads %s content from Graph and safely follows a Microsoft redirect without credentials",
    async (provider) => {
      const { operations, nango } = setup(provider);
      nango.proxy
        .mockResolvedValueOnce(
          Response.json({
            id: "file-1",
            name: "meeting.m4a",
            size: 3,
            file: { mimeType: "audio/mp4" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: {
              location: "https://tenant-my.sharepoint.com/download?id=token",
            },
          }),
        );
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(new Uint8Array([4, 5, 6]), {
          headers: { "content-type": "audio/mp4", "content-length": "3" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        operations.downloadRecordingFile({
          principalId: "principal-1",
          provider,
          fileId: "file-1",
        }),
      ).resolves.toEqual({
        name: "meeting.m4a",
        bytes: new Uint8Array([4, 5, 6]),
        mimeType: "audio/mp4",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://tenant-my.sharepoint.com/download?id=token",
        { method: "GET", redirect: "manual", credentials: "omit" },
      );
      expect(nango.proxy.mock.calls.map(([request]) => request.path)).toEqual([
        "/v1.0/me/drive/items/file-1?%24select=id%2Cname%2Csize%2Cfile%2Cfolder",
        "/v1.0/me/drive/items/file-1/content",
      ]);
    },
  );

  it("requires a connected file-provider connection before making upstream calls", async () => {
    const { operations, repository, nango } = setup();
    repository.findActiveConnection.mockResolvedValue(undefined);
    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationUnavailableError);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it.each(["", "../secret", "folder/file", "bad\\id", "a?b", "a#b"])(
    "rejects unsafe file IDs before proxying: %s",
    async (fileId) => {
      const { operations, nango } = setup();
      await expect(
        operations.downloadRecordingFile({
          principalId: "principal-1",
          provider: "google_drive",
          fileId,
        }),
      ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
      expect(nango.proxy).not.toHaveBeenCalled();
    },
  );

  it("rejects Google Drive folders", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(
      googleMetadata({ mimeType: "application/vnd.google-apps.folder" }),
    );
    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("rejects advertised files larger than 50 MB before downloading", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(googleMetadata({ size: "50000001" }));
    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("rejects actual streaming content above 50 MB even without content-length", async () => {
    const { operations, nango } = setup();
    nango.proxy
      .mockResolvedValueOnce(googleMetadata({ size: undefined }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(30_000_000));
              controller.enqueue(new Uint8Array(20_000_001));
              controller.close();
            },
          }),
          { headers: { "content-type": "audio/mpeg" } },
        ),
      );
    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
  });

  it("rejects empty and unsupported files", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(googleMetadata()).mockResolvedValueOnce(
      new Response(new Uint8Array(), {
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);

    nango.proxy.mockResolvedValueOnce(
      googleMetadata({ name: "notes.txt", mimeType: "text/plain" }),
    );
    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationInputError);
  });

  it.each([
    "https://attacker.example/file?token=x",
    "http://tenant-my.sharepoint.com/file?token=x",
    "https://tenant.sharepoint.com.attacker.example/file?token=x",
  ])(
    "rejects an unsafe OneDrive redirect without fetching it: %s",
    async (url) => {
      const { operations, nango } = setup("onedrive_business");
      nango.proxy
        .mockResolvedValueOnce(
          Response.json({
            id: "file-1",
            name: "meeting.mp3",
            size: 1,
            file: { mimeType: "audio/mpeg" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 302, headers: { location: url } }),
        );
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        operations.downloadRecordingFile({
          principalId: "principal-1",
          provider: "onedrive_business",
          fileId: "file-1",
        }),
      ).rejects.toBeInstanceOf(PersonalIntegrationUpstreamError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects non-success metadata and content responses", async () => {
    const { operations, nango } = setup();
    nango.proxy.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      operations.downloadRecordingFile({
        principalId: "principal-1",
        provider: "google_drive",
        fileId: "file-1",
      }),
    ).rejects.toBeInstanceOf(PersonalIntegrationUpstreamError);
  });
});
