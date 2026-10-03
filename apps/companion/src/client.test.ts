import { describe, expect, it } from "vitest";
import { apiOrigin, companionRequest } from "./client";

describe("Companion connection boundary", () => {
  it("allows HTTPS and local HTTP without credentials or query parameters", () => {
    expect(apiOrigin("https://savia.example/")).toBe("https://savia.example");
    expect(apiOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    for (const url of [
      "http://savia.example",
      "https://user:secret@savia.example",
      "https://savia.example/?token=abc",
      "https://savia.example/path",
    ])
      expect(() => apiOrigin(url)).toThrow();
  });
  it("rejects provider keys and empty access tokens before sending", async () => {
    let called = false;
    const send: typeof fetch = async () => {
      called = true;
      return Response.json({});
    };
    for (const token of [
      "",
      "sk-or-v1-secret",
      " sk-or-v1-secret ",
      "SK-OR-V1-secret",
    ])
      await expect(
        companionRequest(
          "https://savia.example",
          token,
          "capabilities",
          undefined,
          send,
        ),
      ).rejects.toThrow();
    expect(called).toBe(false);
  });
  it("uses the private recording endpoint for explicit saves and listing", async () => {
    const requests: Request[] = [];
    const send: typeof fetch = async (url, init) => {
      requests.push(new Request(url, init));
      return Response.json({});
    };
    await companionRequest(
      "https://savia.example",
      "savia-token",
      "save",
      { id: "stable-id" },
      send,
    );
    await companionRequest(
      "https://savia.example",
      "savia-token",
      "recordings",
      undefined,
      send,
    );
    expect(requests.map((r) => [r.url, r.method])).toEqual([
      ["https://savia.example/v1/companion/recordings", "POST"],
      ["https://savia.example/v1/companion/recordings", "GET"],
    ]);
    expect(requests[0].headers.get("authorization")).toBe("Bearer savia-token");
    expect(await requests[0].json()).toEqual({ id: "stable-id" });
  });
  it("does not retry an ambiguous upstream failure", async () => {
    let attempts = 0;
    await expect(
      companionRequest(
        "https://savia.example",
        "savia-token",
        "transcribe",
        { test: true },
        async () => {
          attempts++;
          return Response.json(
            {
              error: {
                code: "UPSTREAM_TIMEOUT",
                message: "Provider outcome is unknown",
              },
            },
            { status: 504 },
          );
        },
      ),
    ).rejects.toThrow("Provider outcome is unknown");
    expect(attempts).toBe(1);
  });
  it("does not expose untrusted server error bodies", async () => {
    await expect(
      companionRequest(
        "https://savia.example",
        "savia-token",
        "capabilities",
        undefined,
        async () =>
          new Response("<secret>provider-key</secret>", { status: 500 }),
      ),
    ).rejects.toThrow("Request failed (500)");
  });
});

it("allows legacy connections but respects an explicit personal-key upload grant", async () => {
  const { canUploadRecording } = await import("./client");
  expect(canUploadRecording(null)).toBe(false);
  expect(canUploadRecording({ storageAvailable: true } as any)).toBe(true);
  expect(
    canUploadRecording({
      storageAvailable: true,
      grantedRecordingScopes: ["recordings:read"],
    } as any),
  ).toBe(false);
  expect(
    canUploadRecording({
      storageAvailable: true,
      grantedRecordingScopes: ["recordings:upload"],
    } as any),
  ).toBe(true);
  expect(
    canUploadRecording({
      storageAvailable: false,
      grantedRecordingScopes: ["recordings:upload"],
    } as any),
  ).toBe(false);
});
