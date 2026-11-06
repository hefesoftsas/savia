import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { CompanionRecordingsClient } from "./client";
it("fetches private audio with the Savia token and explicit processing consent", async () => {
  const requests: Request[] = [];
  const api = new ApiClient({
    baseUrl: "https://api.savia.test",
    tokenSource: { getAccessToken: async () => "token" },
    fetcher: async (url, init) => {
      const r = new Request(url, init);
      requests.push(r);
      return r.method === "GET"
        ? new Response("ogg", { headers: { "content-type": "audio/ogg" } })
        : Response.json({});
    },
  });
  const client = new CompanionRecordingsClient(api);
  expect((await client.audio("sample")).type).toBe("audio/ogg");
  await client.generate("sample");
  expect(requests[0].headers.get("authorization")).toBe("Bearer token");
  expect(await requests[1].json()).toEqual({ consent: true });
  expect(requests[1].url).toBe(
    "https://api.savia.test/v1/companion/recordings/sample/notes",
  );
});
it("does not automatically retry billable processing", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { error: { code: "UPSTREAM_TIMEOUT", message: "Unknown outcome" } },
        { status: 504 },
      ),
    );
  const client = new CompanionRecordingsClient(
    new ApiClient({
      baseUrl: "https://api.savia.test",
      tokenSource: { getAccessToken: async () => "token" },
      fetcher,
    }),
  );
  await expect(client.generate("id")).rejects.toThrow("Unknown outcome");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("sends uploads as binary bytes and preserves the filename", async () => {
  let request: Request | undefined;
  let uploadBody: Blob | undefined;
  const client = new CompanionRecordingsClient(
    new ApiClient({
      baseUrl: "https://api.savia.test",
      tokenSource: { getAccessToken: async () => "token" },
      fetcher: async (url, init) => {
        request = new Request(url, init);
        uploadBody = init?.body as Blob;
        return Response.json({ id: "saved" });
      },
    }),
  );
  await client.upload(
    new File(["binary-audio"], "meeting one.mp3", { type: "audio/mpeg" }),
  );
  expect(request!.headers.get("content-type")).toBe("application/octet-stream");
  expect(new URL(request!.url).searchParams.get("name")).toBe(
    "meeting one.mp3",
  );
  expect(new URL(request!.url).searchParams.get("format")).toBe("mp3");
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(uploadBody!);
  });
  expect(text).toBe("binary-audio");
});
it("returns only connected and enabled cloud drives", async () => {
  const client = new CompanionRecordingsClient(
    new ApiClient({
      baseUrl: "https://api.savia.test",
      tokenSource: { getAccessToken: async () => null },
      fetcher: async (url) =>
        Response.json({
          data: String(url).endsWith("/providers")
            ? [
                {
                  id: "google_drive",
                  attributes: {
                    displayName: "Google Drive",
                    availability: "enabled",
                  },
                },
                {
                  id: "onedrive_personal",
                  attributes: {
                    displayName: "OneDrive Personal",
                    availability: "enabled",
                  },
                },
                {
                  id: "onedrive_business",
                  attributes: {
                    displayName: "OneDrive for Business",
                    availability: "unavailable",
                  },
                },
              ]
            : [
                {
                  attributes: {
                    provider: "google_drive",
                    status: "connected",
                    externalAccountLabel: "me@example.com",
                  },
                },
                {
                  attributes: {
                    provider: "onedrive_personal",
                    status: "reconnect_required",
                  },
                },
                {
                  attributes: {
                    provider: "onedrive_business",
                    status: "connected",
                  },
                },
              ],
        }),
    }),
  );
  expect(await client.connectedDrives()).toEqual([
    { provider: "google_drive", label: "Google Drive · me@example.com" },
  ]);
});
it("imports Opus container filenames with the Ogg format", async () => {
  let request: Request | undefined;
  const client = new CompanionRecordingsClient(
    new ApiClient({
      baseUrl: "https://api.savia.test",
      tokenSource: { getAccessToken: async () => null },
      fetcher: async (url, init) => {
        request = new Request(url, init);
        return Response.json({});
      },
    }),
  );
  await client.upload(
    new File(["opus"], "Meeting.opus", { type: "audio/ogg" }),
  );
  expect(new URL(request!.url).searchParams.get("format")).toBe("ogg");
});
