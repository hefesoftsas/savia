import { describe, expect, it, vi } from "vitest";
import { createIsGdShortener } from "./shortener";

describe("is.gd shortener", () => {
  it("sends the destination in a bounded POST and validates the provider URL", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ shorturl: "https://is.gd/abc123" }),
    );
    const destination =
      "https://forms.savia.test/public/forms/secret-bearer-token";

    await expect(
      createIsGdShortener(fetcher as typeof fetch).shorten(destination),
    ).resolves.toBe("https://is.gd/abc123");
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://is.gd/create.php?format=json");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(new URLSearchParams(String(init.body)).get("url")).toBe(destination);
  });

  it.each([
    "http://is.gd/abc123",
    "https://is.gd.attacker.test/abc123",
    "https://attacker.test/abc123",
    "https://is.gd/",
  ])("rejects a noncanonical short URL: %s", async (shorturl) => {
    const fetcher = vi.fn(async () => Response.json({ shorturl }));
    await expect(
      createIsGdShortener(fetcher as typeof fetch).shorten(
        "https://example.test",
      ),
    ).rejects.toThrow("invalid URL");
  });

  it("rejects oversized provider responses", async () => {
    const fetcher = vi.fn(
      async () => new Response("x".repeat(8193), { status: 200 }),
    );
    await expect(
      createIsGdShortener(fetcher as typeof fetch).shorten(
        "https://example.test",
      ),
    ).rejects.toThrow("too large");
  });
});
