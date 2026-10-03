import { afterEach, describe, expect, it, vi } from "vitest";
import {
  companionDownloadsResponse,
  createCompanionDownloadsHandler,
} from "./companion-downloads-catalog";

const githubReleasesUrl =
  "https://api.github.com/repos/hefesoftsas/savia/releases?per_page=30";

const sample = [
  {
    tag_name: "companion-preview-12-1",
    draft: false,
    prerelease: true,
    published_at: "2026-10-03T12:00:00Z",
    assets: [
      {
        name: "savia-companion-android.apk",
        size: 123,
        state: "uploaded",
        browser_download_url:
          "https://github.com/hefesoftsas/savia/releases/download/companion-preview-12-1/savia-companion-android.apk",
      },
    ],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Companion download catalog", () => {
  it("reuses a validated catalog across query strings without forwarding them upstream", async () => {
    const fetchUpstream = vi.fn(async () => Response.json(sample));
    vi.stubGlobal("fetch", fetchUpstream);
    const handler = createCompanionDownloadsHandler();
    const first = await handler(
      new Request("https://savia-cache.test/companion-downloads.json?first=1"),
    );
    const second = await handler(
      new Request("https://other-host.test/companion-downloads.json?second=2"),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(sample);
    expect(fetchUpstream).toHaveBeenCalledOnce();
    expect(fetchUpstream).toHaveBeenCalledWith(
      githubReleasesUrl,
      expect.objectContaining({
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Savia-Companion-Downloads",
        },
      }),
    );
    expect(first.headers.get("Cache-Control")).toBe("no-store");
  });

  it("coalesces concurrent cache misses into one upstream request", async () => {
    let finishFetch!: (response: Response) => void;
    const fetchUpstream = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchUpstream);
    const request = () =>
      new Request("https://savia-concurrent.test/companion-downloads.json");

    const handler = createCompanionDownloadsHandler();
    const first = handler(request());
    const second = handler(request());
    await vi.waitFor(() => expect(fetchUpstream).toHaveBeenCalledOnce());
    finishFetch(Response.json(sample));

    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(fetchUpstream).toHaveBeenCalledOnce();
  });

  it("returns a generic non-cacheable 503 for upstream errors and retries next time", async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(new Response("private upstream details", { status: 500 }))
      .mockResolvedValueOnce(Response.json(sample));
    vi.stubGlobal("fetch", fetchUpstream);
    const request = new Request(
      "https://savia-retry.test/companion-downloads.json",
    );

    const handler = createCompanionDownloadsHandler();
    const failed = await handler(request);
    const recovered = await handler(request);

    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private upstream details");
    expect(failed.headers.get("Cache-Control")).toBe("no-store");
    expect(recovered.status).toBe(200);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized or malformed release payloads without caching them", async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ releases: sample }))
      .mockResolvedValueOnce(Response.json(sample));
    vi.stubGlobal("fetch", fetchUpstream);
    const request = new Request(
      "https://savia-invalid.test/companion-downloads.json",
    );

    const handler = createCompanionDownloadsHandler();
    const invalid = await handler(request);
    const valid = await handler(request);

    expect(invalid.status).toBe(503);
    expect(valid.status).toBe(200);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });
});
