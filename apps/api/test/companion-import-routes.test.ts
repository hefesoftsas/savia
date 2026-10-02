import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { expect, it, vi } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerCompanionRoutes } from "../src/companion/routes";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import { opusFixture } from "./fixtures/companion-tone";

function app(download = vi.fn()) {
  const instance = new OpenAPIHono();
  instance.use(
    "/v1/companion/*",
    authenticationMiddleware(
      {} as D1Database,
      platformAdministratorAuthenticator(),
    ),
  );
  registerCompanionRoutes(instance, {
    enabled: true,
    storage: env.DOCUMENTS,
    configuration: {
      effectiveConfigurationFor: async () => ({
        apiKey: "test",
        model: "test/model",
      }),
    },
    personalFiles: { downloadRecordingFile: download },
  });
  return instance;
}
it("uploads binary audio and serves the original content privately", async () => {
  const instance = app();
  const id = crypto.randomUUID();
  const query = new URLSearchParams({
    id,
    name: "Meeting.ogg",
    format: "ogg",
    consent: "true",
  });
  const uploaded = await instance.request(
    `/v1/companion/recordings/upload?${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: opusFixture(),
    },
  );
  expect(uploaded.status).toBe(200);
  expect(await uploaded.json()).toMatchObject({
    id,
    source: "upload",
    name: "Meeting.ogg",
    origin: "local",
  });
  const audio = await instance.request(`/v1/companion/recordings/${id}`);
  expect(audio.headers.get("content-type")).toBe("audio/ogg");
  expect(new Uint8Array(await audio.arrayBuffer())).toEqual(opusFixture());
  await instance.request(`/v1/companion/recordings/${id}`, {
    method: "DELETE",
  });
});
it.each(["google_drive", "onedrive_personal", "onedrive_business"] as const)(
  "imports a selected %s file through the authenticated owner",
  async (provider) => {
    const download = vi.fn(async () => ({
      name: "Cloud meeting.ogg",
      mimeType: "audio/ogg",
      bytes: opusFixture(),
    }));
    const instance = app(download);
    const id = crypto.randomUUID();
    const response = await instance.request("/v1/companion/recordings/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        provider,
        fileId: "file-one",
        consent: true,
      }),
    });
    expect(response.status).toBe(200);
    expect(download).toHaveBeenCalledWith({
      principalId: "test-platform-admin",
      provider,
      fileId: "file-one",
    });
    expect(await response.json()).toMatchObject({
      id,
      name: "Cloud meeting.ogg",
      origin: provider,
    });
    await instance.request(`/v1/companion/recordings/${id}`, {
      method: "DELETE",
    });
  },
);
it("rejects uploads above 50 MB before reading or storing bytes", async () => {
  const response = await app().request(
    `/v1/companion/recordings/upload?${new URLSearchParams({ id: crypto.randomUUID(), name: "large.wav", format: "wav", consent: "true" })}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "50000001",
      },
      body: new Uint8Array([1]),
    },
  );
  expect(response.status).toBe(413);
});
it("requires consent for import and rejects arbitrary file URLs", async () => {
  const download = vi.fn();
  const response = await app(download).request(
    "/v1/companion/recordings/import",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        provider: "google_drive",
        fileId: "file-one",
        consent: false,
        url: "https://example.com",
      }),
    },
  );
  expect(response.status).toBe(400);
  expect(download).not.toHaveBeenCalled();
});

function wavStream(size: number) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === 0) {
        const header = new Uint8Array(44);
        const view = new DataView(header.buffer);
        for (const [offset, tag] of [
          [0, "RIFF"],
          [8, "WAVE"],
          [12, "fmt "],
          [36, "data"],
        ] as const)
          header.set(new TextEncoder().encode(tag), offset);
        view.setUint32(4, size - 8, true);
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 16000, true);
        view.setUint32(28, 32000, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        view.setUint32(40, size - 44, true);
        controller.enqueue(header);
        sent = 44;
        return;
      }
      if (sent < size) {
        const count = Math.min(65536, size - sent);
        controller.enqueue(new Uint8Array(count));
        sent += count;
        return;
      }
      controller.close();
    },
  });
}
it("persists exactly 50 MB of long streamed audio and keeps the original format", async () => {
  const instance = app(),
    id = crypto.randomUUID();
  try {
    const response = await instance.request(
      `/v1/companion/recordings/upload?${new URLSearchParams({ id, name: "Long meeting.wav", format: "wav", consent: "true" })}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: wavStream(50_000_000),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      bytes: 50_000_000,
      format: "wav",
      durationSeconds: (50_000_000 - 44) / 32000,
    });
    const audio = await instance.request(`/v1/companion/recordings/${id}`);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(audio.headers.get("content-length")).toBe("50000000");
    expect(audio.headers.get("content-disposition")).toContain(
      "Long%20meeting.wav",
    );
    await audio.body?.cancel();
  } finally {
    await instance.request(`/v1/companion/recordings/${id}`, {
      method: "DELETE",
    });
  }
});
it.each([undefined, "1"])(
  "rejects an oversized stream even with content-length %s",
  async (length) => {
    const instance = app();
    const headers: Record<string, string> = {
      "content-type": "application/octet-stream",
    };
    if (length) headers["content-length"] = length;
    const response = await instance.request(
      `/v1/companion/recordings/upload?${new URLSearchParams({ id: crypto.randomUUID(), name: "Long meeting.wav", format: "wav", consent: "true" })}`,
      { method: "POST", headers, body: wavStream(50_000_001) },
    );
    expect(response.status).toBe(413);
  },
);
