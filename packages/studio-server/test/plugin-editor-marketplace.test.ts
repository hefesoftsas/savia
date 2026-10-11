import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_EXTENSION_MAX_COMPRESSED_BYTES,
  getOpenVsxVersion,
  searchOpenVsx,
  downloadOpenVsxVsix,
} from "../src/plugin-editor-marketplace";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Open VSX marketplace client", () => {
  it("uses the official search endpoint with a bounded page and returns registry text only", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://open-vsx.org");
      expect(url.pathname).toBe("/api/-/search");
      expect(url.searchParams.get("size")).toBe("20");
      return json({
        totalSize: 25,
        extensions: Array.from({ length: 22 }, (_, i) => ({
          namespace: "Acme",
          name: `extension-${i}`,
          version: "1.2.3",
          displayName: "Example",
          description: "Text only",
          license: "MIT",
          files: { download: "/api/acme/example/1.2.3/file/download" },
        })),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchOpenVsx("editor tools", 0);
    expect(result.results).toHaveLength(20);
    expect(result.results[0]).not.toHaveProperty("downloadUrl");
    expect(result.nextOffset).toBe(20);
  });

  it("rejects malformed or oversized search queries before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchOpenVsx(" ")).rejects.toThrow("1–200");
    await expect(searchOpenVsx("q".repeat(201))).rejects.toThrow("1–200");
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
