import { describe, expect, it, vi } from "vitest";
import {
  DocumentAnalysisError,
  handleStudioDocumentAnalysis,
} from "../src/studio/document-analysis";
import { downloadRemotePdf } from "../src/studio/document-analysis-download";

const pdf = new TextEncoder().encode("%PDF-1.7\nexample");
const publicDownloadHosts = ["docs.example.com", "cdn.example.com"];

function dnsResponse(address = "1.1.1.1") {
  return Response.json({
    Status: 0,
    Answer: [{ type: 1, data: address }],
  });
}

function fetchWith(
  responses: Response[],
  dnsAddress: string | Record<string, string> = "1.1.1.1",
) {
  const queue = [...responses];
  return vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).startsWith("https://cloudflare-dns.com/")) {
      const host = new URL(String(url)).searchParams.get("name") ?? "";
      return dnsResponse(
        typeof dnsAddress === "string"
          ? dnsAddress
          : (dnsAddress[host] ?? "1.1.1.1"),
      );
    }
    const response = queue.shift();
    if (!response) throw new Error("Unexpected document request");
    return response;
  }) as typeof fetch;
}

describe("remote document downloads", () => {
  it("rejects an undeclared host before any network request", async () => {
    const fetcher = fetchWith([
      new Response(pdf, { headers: { "content-type": "application/pdf" } }),
    ]);

    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        ["cdn.example.com"],
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_DOWNLOAD_FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an undeclared redirect host before resolving or fetching it", async () => {
    const fetcher = fetchWith([
      new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/pliego.pdf" },
      }),
    ]);

    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        ["docs.example.com"],
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_DOWNLOAD_FAILED" });
    expect(
      fetcher.mock.calls.filter(
        ([url]) => !String(url).includes("cloudflare-dns.com"),
      ),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([rawUrl]) => {
        const url = new URL(String(rawUrl));
        return (
          url.hostname === "cloudflare-dns.com" &&
          url.searchParams.get("name") === "cdn.example.com"
        );
      }),
    ).toHaveLength(0);
  });

  it("downloads bounded PDF bytes and follows a validated public HTTPS redirect", async () => {
    const fetcher = fetchWith([
      new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/files/pliego.pdf" },
      }),
      new Response(pdf, {
        headers: { "content-type": "application/pdf" },
      }),
    ]);

    const result = await downloadRemotePdf(
      "https://docs.example.com/pliego.pdf",
      "terms.pdf",
      fetcher,
      publicDownloadHosts,
    );

    expect(result.filename).toBe("terms.pdf");
    expect(result.content).toEqual(pdf);
    expect(result.base64).toBe(btoa("%PDF-1.7\nexample"));
    expect(
      fetcher.mock.calls.filter(
        ([url]) => !String(url).includes("cloudflare-dns.com"),
      ),
    ).toHaveLength(2);
  });

  it("rejects a redirect to a private address before fetching it", async () => {
    const fetcher = fetchWith([
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/admin" },
      }),
    ]);

    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        publicDownloadHosts,
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_DOWNLOAD_FAILED" });
    expect(
      fetcher.mock.calls.filter(
        ([url]) => !String(url).includes("cloudflare-dns.com"),
      ),
    ).toHaveLength(1);
  });

  it("rechecks DNS on redirects and rejects a host resolving to a private address", async () => {
    const fetcher = fetchWith(
      [
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/pliego.pdf" },
        }),
      ],
      { "cdn.example.com": "10.0.0.4" },
    );

    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        publicDownloadHosts,
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_DOWNLOAD_FAILED" });
    expect(
      fetcher.mock.calls.filter(
        ([url]) => !String(url).includes("cloudflare-dns.com"),
      ),
    ).toHaveLength(1);
  });

  it("returns a distinct safe error for recognizable CAPTCHA challenge pages", async () => {
    const fetcher = fetchWith([
      new Response(
        "<html><title>Just a moment</title><p>Verify you are human</p></html>",
        {
          status: 403,
          headers: { "content-type": "text/html" },
        },
      ),
    ]);

    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        publicDownloadHosts,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "DOCUMENT_ACCESS_CHALLENGE",
      message: expect.not.stringContaining("Verify you are human"),
    });
  });

  it("rejects ordinary HTML as an invalid document without returning its body", async () => {
    const fetcher = fetchWith([
      new Response("<html><p>unexpected source page</p></html>", {
        headers: { "content-type": "text/html" },
      }),
    ]);
    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        publicDownloadHosts,
      ),
    ).rejects.toMatchObject({
      status: 415,
      code: "INVALID_DOCUMENT",
      message: expect.not.stringContaining("unexpected source page"),
    });
  });

  it("detects a successful CAPTCHA response with a non-HTML content type", async () => {
    const fetcher = fetchWith([
      new Response("<html><p>Access denied by captcha</p></html>", {
        headers: { "content-type": "application/octet-stream" },
      }),
    ]);
    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        publicDownloadHosts,
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_ACCESS_CHALLENGE" });
  });

  it("does not persist or call AI when the source returns a challenge page", async () => {
    const downloadFetchImpl = fetchWith([
      new Response("<html><p>captcha required</p></html>", {
        status: 429,
        headers: { "content-type": "text/html" },
      }),
    ]);
    const persist = vi.fn();
    const aiFetch = vi.fn();
    const response = await handleStudioDocumentAnalysis({
      request: new Request(
        "https://savia.test/v1/studio/101/api/extensions/example.documents/document-analysis",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            object: "customer_documents",
            recordId: "record-1",
            filename: "pliego.pdf",
            downloadUrl: "https://docs.example.com/pliego.pdf?token=private",
            locale: "es",
          }),
        },
      ),
      tenantId: 101,
      actor: { principal: { id: "member-1" } } as never,
      extensionId: "example.documents",
      assistantConfiguration: {
        effectiveConfigurationForTenant: vi.fn(async () => ({
          apiKey: "test-api-key",
          model: "provider/model",
        })),
      },
      isExtensionAvailable: async () => true,
      isCollectionDeclared: async () => true,
      authorizeTarget: async () => {},
      allowedDownloadHosts: ["docs.example.com"],
      persist,
      downloadFetchImpl,
      fetchImpl: aiFetch,
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "DOCUMENT_ACCESS_CHALLENGE" },
    });
    expect(persist).not.toHaveBeenCalled();
    expect(aiFetch).not.toHaveBeenCalled();
  });

  it("checks target authorization before any remote request", async () => {
    const downloadFetchImpl = fetchWith([]);
    const response = await handleStudioDocumentAnalysis({
      request: new Request(
        "https://savia.test/v1/studio/101/api/extensions/example.documents/document-analysis",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            object: "customer_documents",
            recordId: "record-1",
            filename: "pliego.pdf",
            downloadUrl: "https://docs.example.com/pliego.pdf",
          }),
        },
      ),
      tenantId: 101,
      actor: { principal: { id: "member-1" } } as never,
      extensionId: "example.documents",
      assistantConfiguration: {
        effectiveConfigurationForTenant: vi.fn(),
      },
      isExtensionAvailable: async () => true,
      isCollectionDeclared: async () => true,
      authorizeTarget: async () => {
        throw new DocumentAnalysisError("Forbidden.", 403, "FORBIDDEN");
      },
      allowedDownloadHosts: ["docs.example.com"],
      persist: vi.fn(),
      downloadFetchImpl,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    expect(downloadFetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when remote target authorization is not configured", async () => {
    const downloadFetchImpl = fetchWith([]);
    const response = await handleStudioDocumentAnalysis({
      request: new Request(
        "https://savia.test/v1/studio/101/api/extensions/example.documents/document-analysis",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            object: "customer_documents",
            recordId: "record-1",
            filename: "pliego.pdf",
            downloadUrl: "https://docs.example.com/pliego.pdf",
          }),
        },
      ),
      tenantId: 101,
      actor: { principal: { id: "member-1" } } as never,
      extensionId: "example.documents",
      assistantConfiguration: {
        effectiveConfigurationForTenant: vi.fn(),
      },
      isExtensionAvailable: async () => true,
      isCollectionDeclared: async () => true,
      allowedDownloadHosts: ["docs.example.com"],
      persist: vi.fn(),
      downloadFetchImpl,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DOCUMENT_TARGET_AUTHORIZATION_UNAVAILABLE" },
    });
    expect(downloadFetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the extension has no allowed download hosts", async () => {
    const downloadFetchImpl = fetchWith([]);
    const response = await handleStudioDocumentAnalysis({
      request: new Request(
        "https://savia.test/v1/studio/101/api/extensions/example.documents/document-analysis",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            object: "customer_documents",
            recordId: "record-1",
            filename: "pliego.pdf",
            downloadUrl: "https://docs.example.com/pliego.pdf",
          }),
        },
      ),
      tenantId: 101,
      actor: { principal: { id: "member-1" } } as never,
      extensionId: "example.documents",
      assistantConfiguration: {
        effectiveConfigurationForTenant: vi.fn(),
      },
      isExtensionAvailable: async () => true,
      isCollectionDeclared: async () => true,
      authorizeTarget: async () => {},
      persist: vi.fn(),
      downloadFetchImpl,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DOCUMENT_DOWNLOAD_HOSTS_UNAVAILABLE" },
    });
    expect(downloadFetchImpl).not.toHaveBeenCalled();
  });

  it("persists downloaded PDF bytes and analyzes the same file", async () => {
    const downloadFetchImpl = fetchWith([
      new Response(pdf, { headers: { "content-type": "application/pdf" } }),
    ]);
    const persist = vi.fn(async (input: { content: Uint8Array }) => ({
      id: "remote-file",
      name: "pliego.pdf",
      mime: "application/pdf",
      size: input.content.byteLength,
      version: 1,
    }));
    const authorizeTarget = vi.fn(async () => {});
    const aiFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.messages[1].content[1].file.file_data).toBe(
          `data:application/pdf;base64,${btoa("%PDF-1.7\nexample")}`,
        );
        expect(String(init?.body)).not.toContain("token=private");
        return Response.json({
          choices: [{ message: { content: "Resumen" } }],
        });
      },
    );
    const response = await handleStudioDocumentAnalysis({
      request: new Request(
        "https://savia.test/v1/studio/101/api/extensions/example.documents/document-analysis",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            object: "customer_documents",
            recordId: "record-1",
            filename: "pliego.pdf",
            downloadUrl: "https://docs.example.com/pliego.pdf?token=private",
            locale: "es",
          }),
        },
      ),
      tenantId: 101,
      actor: { principal: { id: "member-1" } } as never,
      extensionId: "example.documents",
      assistantConfiguration: {
        effectiveConfigurationForTenant: vi.fn(async () => ({
          apiKey: "test-api-key",
          model: "provider/model",
        })),
      },
      isExtensionAvailable: async () => true,
      isCollectionDeclared: async () => true,
      authorizeTarget,
      allowedDownloadHosts: ["docs.example.com"],
      persist,
      downloadFetchImpl,
      fetchImpl: aiFetch,
    });

    expect(response.status).toBe(201);
    expect(authorizeTarget).toHaveBeenCalledWith(
      "customer_documents",
      "record-1",
    );
    expect(authorizeTarget.mock.invocationCallOrder[0]).toBeLessThan(
      downloadFetchImpl.mock.invocationCallOrder[0],
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ content: pdf, filename: "pliego.pdf" }),
    );
    expect(aiFetch).toHaveBeenCalledOnce();
    expect((await response.json()).data.file.id).toBe("remote-file");
  });

  it("rejects response bodies over five MiB even when Content-Length is absent", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set(new TextEncoder().encode("%PDF-1.7"));
    const fetcher = fetchWith([new Response(oversized)]);

    await expect(
      downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        publicDownloadHosts,
      ),
    ).rejects.toMatchObject({ status: 413, code: "DOCUMENT_TOO_LARGE" });
  });

  it("rejects a response that stalls after a PDF prefix when the deadline expires", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith("https://cloudflare-dns.com/"))
        return dnsResponse();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("%PDF-"));
          },
        }),
      );
    }) as typeof fetch;
    try {
      const download = downloadRemotePdf(
        "https://docs.example.com/pliego.pdf",
        "pliego.pdf",
        fetcher,
        publicDownloadHosts,
      );
      const rejection = expect(download).rejects.toMatchObject({
        code: "DOCUMENT_DOWNLOAD_FAILED",
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "http://docs.example.com/pliego.pdf",
    "https://docs.example.com:8443/pliego.pdf",
    "https://user:pass@docs.example.com/pliego.pdf",
    "https://127.0.0.1/pliego.pdf",
  ])("rejects unsafe remote URL %s before network access", async (url) => {
    const fetcher = fetchWith([]);
    await expect(
      downloadRemotePdf(url, "pliego.pdf", fetcher, publicDownloadHosts),
    ).rejects.toMatchObject({
      code: "DOCUMENT_DOWNLOAD_FAILED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
