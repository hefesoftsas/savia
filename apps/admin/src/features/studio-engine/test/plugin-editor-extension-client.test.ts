import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginEditorExtensionClient,
  PluginEditorExtensionClientError,
  type MarketplaceExtension,
} from "../plugin-editor-extension-client";

const installed = {
  id: "Acme.example",
  publisher: "Acme",
  name: "example",
  version: "1.0.0",
  sha256: "a".repeat(64),
  license: "MIT",
  compressedBytes: 12,
  expandedBytes: 24,
  dependencies: [],
  compatibility: { supported: true, reason: null },
  installationId: "f3286d10-a0b8-48c8-ad88-c6adbe54fa01",
  source: "vsix" as const,
  createdAt: "2026-10-11T00:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("PluginEditorExtensionClient", () => {
  it("preserves actionable gateway errors for incompatible marketplace packages", async () => {
    const client = new PluginEditorExtensionClient(async () =>
      Response.json(
        {
          error: {
            code: "CRM_ERROR",
            message:
              "This extension requires a desktop host and cannot run in the web editor.",
          },
        },
        { status: 422 },
      ),
    );
    await expect(
      client.inspectMarketplace({
        publisher: "openai",
        name: "chatgpt",
        version: "26.5908.31748",
        displayName: null,
        description: null,
        license: null,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message:
        "This extension requires a desktop host and cannot run in the web editor.",
    });
  });

  it("sends marketplace queries with their abort signal and keeps response metadata typed", async () => {
    const fetcher = vi.fn(async (_path: string, _init?: RequestInit) =>
      Response.json({
        results: [],
        offset: 20,
        totalSize: 21,
        nextOffset: null,
      }),
    );
    const client = new PluginEditorExtensionClient(fetcher);
    const controller = new AbortController();
    await expect(
      client.search("theme tools", 20, controller.signal),
    ).resolves.toEqual({
      results: [],
      offset: 20,
      totalSize: 21,
      nextOffset: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/plugin-editor-extensions/marketplace?q=theme+tools&offset=20",
      { signal: controller.signal },
    );
  });

  it("preserves the selected web build identity from search through inspection", async () => {
    const webResult: MarketplaceExtension = {
      publisher: "Acme",
      name: "example",
      version: "1.0.0",
      displayName: "Example Extension",
      description: "A sample extension from Open VSX.",
      license: "MIT",
      targetPlatform: "web",
    };
    const fetcher = vi.fn(async (path: string) => {
      if (path.startsWith("/api/plugin-editor-extensions/marketplace"))
        return Response.json({
          results: [webResult],
          offset: 0,
          totalSize: 1,
          nextOffset: null,
        });
      return Response.json({ inspectionId: "web-inspection" });
    });
    const client = new PluginEditorExtensionClient(fetcher);

    const page = await client.search("");
    expect(page.results[0]?.targetPlatform).toBe("web");
    await client.inspectMarketplace(page.results[0]!);

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/plugin-editor-extensions/inspect",
      expect.objectContaining({
        body: JSON.stringify({
          source: "open-vsx",
          publisher: "Acme",
          name: "example",
          version: "1.0.0",
          targetPlatform: "web",
        }),
      }),
    );
  });

  it("rejects native marketplace builds before inspection with an actionable error", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ inspectionId: "unused" }),
    );
    const client = new PluginEditorExtensionClient(fetcher);

    await expect(
      client.inspectMarketplace({
        publisher: "Acme",
        name: "example",
        version: "1.0.0",
        targetPlatform: "alpine-arm64",
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("web or universal"),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uploads VSIX bytes directly and submits exact Open VSX coordinates for inspection", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ inspectionId: "inspection" }),
    );
    const client = new PluginEditorExtensionClient(fetcher);
    const file = new File([new Uint8Array([1, 2, 3])], "sample.vsix", {
      type: "application/zip",
    });
    await client.inspectUpload(file);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/plugin-editor-extensions/inspect?source=vsix&fileName=sample.vsix",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      }),
    );
    const marketplaceResult: MarketplaceExtension = {
      publisher: "Acme",
      name: "example",
      version: "1.0.0",
      displayName: "Example Extension",
      description: "A sample extension from Open VSX.",
      license: "MIT",
    };
    await client.inspectMarketplace(marketplaceResult);
    const marketplaceRequest = JSON.parse(
      fetcher.mock.calls[1]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(Object.keys(marketplaceRequest).sort()).toEqual([
      "name",
      "publisher",
      "source",
      "version",
    ]);
    expect(marketplaceRequest).toEqual({
      source: "open-vsx",
      publisher: "Acme",
      name: "example",
      version: "1.0.0",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/plugin-editor-extensions/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "open-vsx",
          publisher: "Acme",
          name: "example",
          version: "1.0.0",
        }),
      },
    );
  });

  it("installs, lists, downloads, and removes packages through the scoped API", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const fetcher = vi.fn(async (path: string) => {
      if (path.endsWith("/install"))
        return Response.json({ installation: installed });
      if (path.endsWith("/installed"))
        return Response.json({ installations: [installed] });
      if (path.endsWith("/package")) return new Response(bytes);
      if (path.endsWith(installed.installationId))
        return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = new PluginEditorExtensionClient(fetcher);
    await expect(client.install("inspection-id")).resolves.toEqual(installed);
    await expect(client.list()).resolves.toEqual([installed]);
    await expect(
      client.downloadPackage(installed.installationId),
    ).resolves.toEqual(bytes);
    await expect(
      client.uninstall(installed.installationId),
    ).resolves.toBeUndefined();
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/plugin-editor-extensions/install",
      "/api/plugin-editor-extensions/installed",
      `/api/plugin-editor-extensions/installed/${installed.installationId}/package`,
      `/api/plugin-editor-extensions/installed/${installed.installationId}`,
    ]);
  });

  it("preserves structured removal conflicts, including referencing project IDs", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: "Extension is referenced by projects.",
          projectIds: ["project-1"],
        },
        { status: 409 },
      ),
    );
    const client = new PluginEditorExtensionClient(fetcher);
    await expect(
      client.uninstall(installed.installationId),
    ).rejects.toMatchObject({
      name: "PluginEditorExtensionClientError",
      status: 409,
      details: { projectIds: ["project-1"] },
    } satisfies Partial<PluginEditorExtensionClientError>);
  });
});
