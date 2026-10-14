import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_EXTENSION_MAX_COMPRESSED_BYTES,
  getOpenVsxVersion,
  getOpenVsxManifest,
  openVsxRequestDeadline,
  searchOpenVsx,
  downloadOpenVsxVsix,
} from "../src/plugin-editor-marketplace";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

function extensionMetadata(publisher: string, name: string, version: string) {
  return {
    namespace: publisher,
    name,
    version,
    displayName: name,
    description: "Example extension",
    license: "MIT",
    targetPlatform: "universal",
    files: {
      download: `https://open-vsx.org/api/${publisher}/${name}/universal/${version}/file/download`,
    },
  };
}

function webManifest(
  publisher: string,
  name: string,
  version: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    publisher,
    name,
    version,
    engines: { vscode: "^1.138.0" },
    browser: "browser.js",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Open VSX marketplace client", () => {
  it("retains ratings, reviews and downloads on filtered marketplace results", async () => {
    const item = {
      ...extensionMetadata("Acme", "rated", "1.2.3"),
      averageRating: 4.75,
      reviewCount: 12,
      downloadCount: 12345,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/-/search")
          return json({ totalSize: 1, extensions: [item] });
        if (path.endsWith("/file/package.json"))
          return json(webManifest("Acme", "rated", "1.2.3"));
        return json(item);
      }),
    );
    const result = await searchOpenVsx("rated");
    expect(result.results[0]).toMatchObject({
      averageRating: 4.75,
      reviewCount: 12,
      downloadCount: 12345,
    });
  });

  it.each([
    [{}, { averageRating: null, reviewCount: null, downloadCount: null }],
    [
      { averageRating: 0, reviewCount: 0, downloadCount: 0 },
      { averageRating: 0, reviewCount: 0, downloadCount: 0 },
    ],
    [
      { averageRating: 6, reviewCount: -1, downloadCount: 1.5 },
      { averageRating: null, reviewCount: null, downloadCount: null },
    ],
    [
      {
        averageRating: "4",
        reviewCount: "10",
        downloadCount: Number.MAX_SAFE_INTEGER + 1,
      },
      { averageRating: null, reviewCount: null, downloadCount: null },
    ],
  ])(
    "keeps missing or invalid popularity metrics distinct from zero: %j",
    async (fields, expected) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json({ ...extensionMetadata("Acme", "rated", "1.2.3"), ...fields }),
        ),
      );
      expect(await getOpenVsxVersion("Acme", "rated", "1.2.3")).toMatchObject(
        expected,
      );
    },
  );

  it("uses the official search endpoint with a bounded page and returns registry text only", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://open-vsx.org");
      if (url.pathname === "/api/-/search") {
        expect(url.searchParams.get("size")).toBe("20");
        expect(url.searchParams.get("query")).toBe("editor tools");
        expect(url.searchParams.has("sortBy")).toBe(false);
        expect(url.searchParams.has("sortOrder")).toBe(false);
        return json({
          totalSize: 25,
          extensions: Array.from({ length: 22 }, (_, i) =>
            extensionMetadata("Acme", `extension-${i}`, "1.2.3"),
          ),
        });
      }
      const manifestName = url.pathname.match(
        /\/api\/Acme\/([^/]+)\/universal\/1\.2\.3\/file\/package\.json$/,
      )?.[1];
      if (manifestName) return json(webManifest("Acme", manifestName, "1.2.3"));
      const versionName = url.pathname.match(
        /\/api\/Acme\/([^/]+)\/universal\/1\.2\.3$/,
      )?.[1];
      if (versionName)
        return json(extensionMetadata("Acme", versionName, "1.2.3"));
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchOpenVsx("editor tools", 0);
    expect(result.results).toHaveLength(20);
    expect(result.results[0]).not.toHaveProperty("downloadUrl");
    expect(result.nextOffset).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(41);
  });

  it("browses popular snippets without a user query and preserves the requested offset", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://open-vsx.org");
      expect(url.pathname).toBe("/api/-/search");
      expect(url.searchParams.get("query")).toBe("snippets");
      expect(url.searchParams.get("sortBy")).toBe("downloadCount");
      expect(url.searchParams.get("sortOrder")).toBe("desc");
      expect(url.searchParams.get("offset")).toBe("20");
      expect(url.searchParams.get("size")).toBe("20");
      return json({ totalSize: 40, extensions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchOpenVsx("  ", 20)).resolves.toMatchObject({
      results: [],
      offset: 20,
      totalSize: 40,
      nextOffset: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose a native build from the default snippets browse", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/-/search") {
        expect(url.searchParams.get("query")).toBe("snippets");
        return json({
          totalSize: 1,
          extensions: [
            {
              ...extensionMetadata("Acme", "native-snippets", "1.0.0"),
              files: {
                download:
                  "https://open-vsx.org/api/Acme/native-snippets/alpine-arm64/1.0.0/file/native.vsix",
              },
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchOpenVsx("", 0)).resolves.toMatchObject({
      results: [],
      totalSize: 1,
      nextOffset: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters unsupported and unknown manifests while preserving raw page pagination", async () => {
    let activeFetches = 0;
    let maximumActiveFetches = 0;
    const entries = [
      extensionMetadata("Acme", "compatible", "1.2.3"),
      {
        ...extensionMetadata("Acme", "native", "1.2.3"),
        targetPlatform: "alpine-arm64",
      },
      extensionMetadata("Acme", "desktop", "1.2.3"),
      extensionMetadata("Acme", "unknown", "1.2.3"),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      activeFetches++;
      maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const url = new URL(String(input));
        if (url.pathname === "/api/-/search")
          return json({ totalSize: 87, extensions: entries });
        const versionName = url.pathname.match(
          /\/api\/Acme\/([^/]+)\/universal\/1\.2\.3$/,
        )?.[1];
        if (versionName)
          return json({
            ...extensionMetadata("Acme", versionName, "1.2.3"),
            ...(versionName === "native"
              ? { targetPlatform: "alpine-arm64" }
              : {}),
          });
        const manifestName = url.pathname.match(
          /\/api\/Acme\/([^/]+)\/universal\/1\.2\.3\/file\/package\.json$/,
        )?.[1];
        if (manifestName === "unknown")
          return new Response(null, { status: 404 });
        if (manifestName === "desktop")
          return json(
            webManifest("Acme", manifestName, "1.2.3", {
              main: "main.js",
              browser: undefined,
            }),
          );
        if (manifestName)
          return json(webManifest("Acme", manifestName, "1.2.3"));
        return new Response(null, { status: 404 });
      } finally {
        activeFetches--;
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchOpenVsx("term", 40);
    expect(result).toMatchObject({
      offset: 40,
      totalSize: 87,
      nextOffset: 44,
      results: [{ publisher: "Acme", name: "compatible", version: "1.2.3" }],
    });
    expect(maximumActiveFetches).toBeLessThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("rejects malformed or oversized search queries before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchOpenVsx("q".repeat(201))).rejects.toThrow("200");
    await expect(searchOpenVsx("extension", -1)).rejects.toThrow("offset");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires exact-version metadata and only allows same-origin redirects", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        namespace: "Acme",
        name: "editor",
        version: "1.2.3",
        files: {
          download: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getOpenVsxVersion("Acme", "editor", "1.2.3"),
    ).resolves.toMatchObject({ publisher: "Acme", version: "1.2.3" });
    const redirectFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://attacker.invalid/file.vsix" },
        }),
    );
    vi.stubGlobal("fetch", redirectFetch);
    await expect(
      downloadOpenVsxVsix({
        publisher: "Acme",
        name: "editor",
        version: "1.2.3",
        displayName: null,
        description: null,
        license: null,
        downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
      }),
    ).rejects.toThrow("untrusted origin");
    expect(redirectFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicitly selected web build through exact metadata and manifest lookup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/Acme/editor/web/1.2.3")
        return json({
          namespace: "Acme",
          name: "editor",
          version: "1.2.3",
          targetPlatform: "web",
          files: {
            download:
              "https://open-vsx.org/api/Acme/editor/web/1.2.3/file/editor-web.vsix",
          },
        });
      if (url.pathname === "/api/Acme/editor/web/1.2.3/file/package.json")
        return json(webManifest("Acme", "editor", "1.2.3"));
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await getOpenVsxVersion(
      "Acme",
      "editor",
      "1.2.3",
      openVsxRequestDeadline(),
      "web",
    );
    await expect(
      getOpenVsxManifest(metadata, "1.138.0", openVsxRequestDeadline()),
    ).resolves.toMatchObject({ version: "1.2.3" });
    expect(metadata.targetPlatform).toBe("web");
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual([
      "/api/Acme/editor/web/1.2.3",
      "/api/Acme/editor/web/1.2.3/file/package.json",
    ]);
  });

  it("qualifies universal metadata and manifest requests to preserve build identity", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/Acme/editor/universal/1.2.3")
        return json({
          namespace: "Acme",
          name: "editor",
          version: "1.2.3",
          targetPlatform: "universal",
          files: {
            download:
              "https://open-vsx.org/api/Acme/editor/universal/1.2.3/file/editor.vsix",
          },
        });
      if (url.pathname === "/api/Acme/editor/universal/1.2.3/file/package.json")
        return json(webManifest("Acme", "editor", "1.2.3"));
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await getOpenVsxVersion(
      "Acme",
      "editor",
      "1.2.3",
      openVsxRequestDeadline(),
      "universal",
    );
    await getOpenVsxManifest(metadata, "1.138.0", openVsxRequestDeadline());

    expect(metadata.targetPlatform).toBe("universal");
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual([
      "/api/Acme/editor/universal/1.2.3",
      "/api/Acme/editor/universal/1.2.3/file/package.json",
    ]);
  });

  it("rejects a mismatched build returned for a platform-qualified lookup", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        namespace: "Acme",
        name: "editor",
        version: "1.2.3",
        targetPlatform: "alpine-arm64",
        files: {
          download:
            "https://open-vsx.org/api/Acme/editor/alpine-arm64/1.2.3/file/editor.vsix",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getOpenVsxVersion(
        "Acme",
        "editor",
        "1.2.3",
        openVsxRequestDeadline(),
        "web",
      ),
    ).rejects.toThrow(/returned the alpine-arm64 build/i);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/Acme/editor/web/1.2.3",
    );
  });

  it("rejects a selected build whose download URL changes package coordinates", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        namespace: "Acme",
        name: "editor",
        version: "1.2.3",
        targetPlatform: "web",
        files: {
          download:
            "https://open-vsx.org/api/Other/editor/web/1.2.3/file/editor.vsix",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getOpenVsxVersion(
        "Acme",
        "editor",
        "1.2.3",
        openVsxRequestDeadline(),
        "web",
      ),
    ).rejects.toThrow(/coordinates/i);
  });

  it("loads bounded package manifests through the official CDN and rejects mismatched coordinates", async () => {
    const metadata = {
      publisher: "Acme",
      name: "editor",
      version: "1.2.3",
      displayName: "editor",
      description: null,
      license: null,
      downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
      targetPlatform: null,
    };
    let canceled = false;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array([1]));
              },
              cancel() {
                canceled = true;
              },
            }),
            {
              status: 302,
              headers: {
                location:
                  "https://openvsx.eclipsecontent.org/Acme/editor/1.2.3/package.json",
              },
            },
          ),
      )
      .mockImplementationOnce(async (input) => {
        expect(new URL(String(input)).origin).toBe(
          "https://openvsx.eclipsecontent.org",
        );
        return json(webManifest("acme", "EDITOR", "1.2.3"));
      });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getOpenVsxManifest(metadata, "1.138.0", openVsxRequestDeadline()),
    ).resolves.toMatchObject({ publisher: "acme", name: "EDITOR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(canceled).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(webManifest("Other", "editor", "1.2.3"))),
    );
    await expect(getOpenVsxManifest(metadata)).rejects.toThrow(/did not match/);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            headers: { "content-length": String(1_048_577) },
          }),
      ),
    );
    await expect(getOpenVsxManifest(metadata)).rejects.toThrow("size limit");
  });

  it("shares one 15-second deadline across all bounded search preflights", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/-/search")
          return json({
            totalSize: 3,
            extensions: ["one", "two", "three"].map((name) =>
              extensionMetadata("Acme", name, "1.2.3"),
            ),
          });
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const resultPromise = searchOpenVsx("slow");
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(resultPromise).resolves.toMatchObject({
      results: [],
      offset: 0,
      totalSize: 3,
      nextOffset: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("allows the official CDN only as a redirect from an Open VSX package URL", async () => {
    let redirectBodyCancelled = false;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            redirectBodyCancelled = true;
          },
        });
        return new Response(body, {
          status: 302,
          headers: {
            location:
              "https://openvsx.eclipsecontent.org/Acme/editor/1.2.3/editor.vsix",
          },
        });
      })
      .mockImplementationOnce(async (input) => {
        expect(new URL(String(input)).origin).toBe(
          "https://openvsx.eclipsecontent.org",
        );
        return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadOpenVsxVsix({
        publisher: "Acme",
        name: "editor",
        version: "1.2.3",
        displayName: null,
        description: null,
        license: null,
        downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
      }),
    ).resolves.toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(redirectBodyCancelled).toBe(true);
  });

  it.each([
    "https://attacker.invalid/package.vsix",
    "https://open-vsx.eclipsecontent.org/package.vsix",
    "https://openvsx.eclipsecontent.org.attacker.invalid/package.vsix",
    "http://openvsx.eclipsecontent.org/package.vsix",
    "https://user:password@openvsx.eclipsecontent.org/package.vsix",
  ])("rejects untrusted download redirect target %s", async (location) => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadOpenVsxVsix({
        publisher: "Acme",
        name: "editor",
        version: "1.2.3",
        displayName: null,
        description: null,
        license: null,
        downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
      }),
    ).rejects.toThrow("untrusted origin");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an untrusted redirect after reaching the official CDN", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://openvsx.eclipsecontent.org/Acme/editor/1.2.3/editor.vsix",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://attacker.invalid/package.vsix" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadOpenVsxVsix({
        publisher: "Acme",
        name: "editor",
        version: "1.2.3",
        displayName: null,
        description: null,
        license: null,
        downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
      }),
    ).rejects.toThrow("untrusted origin");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the redirect bound and package size cap after a CDN redirect", async () => {
    let cancelledBodies = 0;
    const redirect = (location: string) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            cancelledBodies++;
          },
        }),
        { status: 302, headers: { location } },
      );
    const tooManyRedirects = vi
      .fn()
      .mockResolvedValueOnce(
        redirect("https://openvsx.eclipsecontent.org/first.vsix"),
      )
      .mockResolvedValueOnce(redirect("https://open-vsx.org/second.vsix"))
      .mockResolvedValueOnce(
        redirect("https://openvsx.eclipsecontent.org/third.vsix"),
      );
    vi.stubGlobal("fetch", tooManyRedirects);
    const metadata = {
      publisher: "Acme",
      name: "editor",
      version: "1.2.3",
      displayName: null,
      description: null,
      license: null,
      downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
    };
    await expect(downloadOpenVsxVsix(metadata)).rejects.toThrow(
      "too many redirects",
    );
    expect(tooManyRedirects).toHaveBeenCalledTimes(3);
    expect(cancelledBodies).toBe(3);

    const oversizedCdnResponse = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://openvsx.eclipsecontent.org/Acme/editor/1.2.3/editor.vsix",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            "content-length": String(EDITOR_EXTENSION_MAX_COMPRESSED_BYTES + 1),
          },
        }),
      );
    vi.stubGlobal("fetch", oversizedCdnResponse);
    await expect(downloadOpenVsxVsix(metadata)).rejects.toThrow("size limit");
    expect(oversizedCdnResponse).toHaveBeenCalledTimes(2);
  });

  it("cancels an oversized VSIX response body before returning the size error", async () => {
    let bodyCancelled = false;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
            cancel() {
              bodyCancelled = true;
            },
          }),
          {
            headers: {
              "content-length": String(
                EDITOR_EXTENSION_MAX_COMPRESSED_BYTES + 1,
              ),
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadOpenVsxVsix({
        publisher: "Acme",
        name: "editor",
        version: "1.2.3",
        displayName: null,
        description: null,
        license: null,
        downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(bodyCancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps API redirects and initial package URLs restricted to Open VSX", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://openvsx.eclipsecontent.org/Acme/editor/1.2.3/editor.vsix",
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchOpenVsx("editor tools")).rejects.toThrow(
      "untrusted origin",
    );
    await expect(getOpenVsxVersion("Acme", "editor", "1.2.3")).rejects.toThrow(
      "untrusted origin",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const initialCdnFetch = vi.fn();
    vi.stubGlobal("fetch", initialCdnFetch);
    await expect(
      downloadOpenVsxVsix({
        publisher: "Acme",
        name: "editor",
        version: "1.2.3",
        displayName: null,
        description: null,
        license: null,
        downloadUrl:
          "https://openvsx.eclipsecontent.org/Acme/editor/1.2.3/editor.vsix",
      }),
    ).rejects.toThrow("untrusted download URL");
    expect(initialCdnFetch).not.toHaveBeenCalled();
  });

  it("enforces streamed response limits and a 15-second abort deadline", async () => {
    const huge = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(20 * 1024 * 1024));
              controller.enqueue(new Uint8Array(1));
              controller.close();
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", huge);
    const metadata = {
      publisher: "Acme",
      name: "editor",
      version: "1.2.3",
      displayName: null,
      description: null,
      license: null,
      downloadUrl: "https://open-vsx.org/api/Acme/editor/1.2.3/file/download",
    };
    await expect(downloadOpenVsxVsix(metadata)).rejects.toThrow("size limit");

    vi.useFakeTimers();
    const hanging = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", hanging);
    const request = searchOpenVsx("extensions");
    const timedOut = expect(request).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_001);
    await timedOut;
  });
});
