import { describe, expect, it, vi } from "vitest";
import { createShlinkShortener } from "./shortener";

const serverUrl = "https://go.cloud.hefesoft.com";
const apiKey = "shlink-test-api-key";
const destination = "https://forms.savia.test/public/forms/secret-bearer-token";

describe("Shlink shortener", () => {
  it("sends an authenticated JSON request and validates the returned URL", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ shortUrl: "https://go.cloud.hefesoft.com/abc123" }),
    );

    await expect(
      createShlinkShortener({
        serverUrl,
        apiKey,
        fetcher: fetcher as typeof fetch,
      }).shorten(destination),
    ).resolves.toBe("https://go.cloud.hefesoft.com/abc123");
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://go.cloud.hefesoft.com/rest/v3/short-urls");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("X-Api-Key")).toBe(apiKey);
    expect(JSON.parse(String(init.body))).toEqual({ longUrl: destination });
  });

  it.each([
    "http://go.cloud.hefesoft.com/abc123",
    "https://go.cloud.hefesoft.com.attacker.test/abc123",
    "https://attacker.test/abc123",
    "https://go.cloud.hefesoft.com/",
    "https://go.cloud.hefesoft.com/abc123?target=attacker.test",
  ])("rejects a noncanonical short URL: %s", async (shortUrl) => {
    const fetcher = vi.fn(async () => Response.json({ shortUrl }));
    await expect(
      createShlinkShortener({
        serverUrl,
        apiKey,
        fetcher: fetcher as typeof fetch,
      }).shorten(destination),
    ).rejects.toThrow("invalid URL");
  });

  it("rejects local or insecure destinations before calling Shlink", async () => {
    const fetcher = vi.fn();
    const shorten = createShlinkShortener({
      serverUrl,
      apiKey,
      fetcher: fetcher as typeof fetch,
    }).shorten;
    await expect(shorten("http://127.0.0.1/private")).rejects.toThrow(
      "Invalid public destination",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects oversized provider responses", async () => {
    const fetcher = vi.fn(
      async () => new Response("x".repeat(4097), { status: 200 }),
    );
    await expect(
      createShlinkShortener({
        serverUrl,
        apiKey,
        fetcher: fetcher as typeof fetch,
      }).shorten(destination),
    ).rejects.toThrow("invalid data");
  });

  it("sanitizes authentication and network failures", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ detail: "secret server details" }, { status: 401 }),
    );
    await expect(
      createShlinkShortener({
        serverUrl,
        apiKey,
        fetcher: fetcher as typeof fetch,
      }).shorten(destination),
    ).rejects.toThrow("Shlink request failed");
  });
});
