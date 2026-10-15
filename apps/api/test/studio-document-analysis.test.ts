import { describe, expect, it, vi } from "vitest";
import {
  analyzeDocumentPdf,
  decodeDocumentPdfRequest,
  handleStudioDocumentAnalysis,
  readBoundedJson,
} from "../src/studio/document-analysis";

const pdfBytes = new TextEncoder().encode("%PDF-1.7\nexample");
function base64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x7ffe;
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  return btoa(binary);
}
const pdfBase64 = base64(pdfBytes);
const input = {
  object: "customer_documents",
  recordId: "record-1",
  filename: "pliego.pdf",
  data: pdfBase64,
  locale: "es",
  sourceUrl: "https://www.colombiacompra.gov.co/pliego.pdf",
};

function configuration() {
  return {
    effectiveConfigurationForTenant: vi.fn(
      async (principalId: string, tenantId: number) => {
        expect(principalId).toBe("member-1");
        expect(tenantId).toBe(101);
        return {
          apiKey: "test-api-key",
          model: "provider/model",
          summaryModel: "provider/summary",
        };
      },
    ),
  };
}

describe("Studio extension document analysis", () => {
  it("rejects non-PDF bytes and decoded files above 5 MB", () => {
    expect(() =>
      decodeDocumentPdfRequest({ ...input, data: btoa("not a pdf") }),
    ).toThrow("PDF");

    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set(new TextEncoder().encode("%PDF-1.7"));
    const oversizedBase64 = base64(oversized);
    expect(oversizedBase64.length % 4).toBe(0);
    expect(() => atob(oversizedBase64)).not.toThrow();
    expect(() =>
      decodeDocumentPdfRequest({
        ...input,
        data: oversizedBase64,
      }),
    ).toThrow("5 MB");
  });

  it("bounds the raw JSON request body even without Content-Length", async () => {
    const request = new Request("https://savia.test", {
      method: "POST",
      body: "x".repeat(64),
    });
    await expect(readBoundedJson(request, 32)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("persists the PDF and sends it as a file-parser data URL using tenant configuration", async () => {
    const assistantConfiguration = configuration();
    const persist = vi.fn(async () => ({
      id: "file-1",
      name: "pliego.pdf",
      mime: "application/pdf",
      size: pdfBytes.byteLength,
      version: 1,
    }));
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("provider/summary");
        expect(body.max_tokens).toBe(4000);
        expect(body.plugins).toEqual([
          { id: "file-parser", pdf: { engine: "pdf-text" } },
        ]);
        expect(body.messages[1].content[1].file.file_data).toMatch(
          /^data:application\/pdf;base64,/,
        );
        return Response.json({
          choices: [{ message: { content: "Resumen del pliego" } }],
        });
      },
    );

    const result = await analyzeDocumentPdf({
      input: decodeDocumentPdfRequest(input),
      tenantId: 101,
      principalId: "member-1",
      assistantConfiguration,
      persist,
      fetchImpl,
      now: () => new Date("2026-10-14T12:00:00.000Z"),
    });

    expect(
      assistantConfiguration.effectiveConfigurationForTenant,
    ).toHaveBeenCalledWith("member-1", 101);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        object: "customer_documents",
        recordId: "record-1",
        filename: "pliego.pdf",
        content: pdfBytes,
      }),
    );
    expect(result).toEqual({
      file: expect.objectContaining({ id: "file-1", name: "pliego.pdf" }),
      analysis: "Resumen del pliego",
      model: "provider/summary",
      analyzedAt: "2026-10-14T12:00:00.000Z",
    });
  });

  it("returns the persisted file ID after a provider failure without exposing provider details", async () => {
    const persist = vi.fn(async () => ({
      id: "file-2",
      name: "pliego.pdf",
      mime: "application/pdf",
      size: pdfBytes.byteLength,
      version: 1,
    }));
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: { message: "private provider detail" } },
        { status: 500 },
      ),
    );

    await expect(
      analyzeDocumentPdf({
        input: decodeDocumentPdfRequest(input),
        tenantId: 101,
        principalId: "member-1",
        assistantConfiguration: configuration(),
        persist,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 502,
      fileId: "file-2",
      message: "Document analysis is temporarily unavailable.",
    });
  });

  it("retries analysis from an ACL-loaded saved file without uploading a duplicate", async () => {
    const persist = vi.fn();
    const fetchImpl = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: "Retry analysis" } }] }),
    );
    const request = new Request(
      "https://savia.test/v1/studio/101/api/extensions/example.documents/document-analysis",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          object: "customer_documents",
          recordId: "record-1",
          fileId: "6f519c54-f669-4b2c-aed4-4a7999297bd2",
          locale: "es",
        }),
      },
    );
    const response = await handleStudioDocumentAnalysis({
      request,
      tenantId: 101,
      actor: { principal: { id: "member-1" } } as never,
      extensionId: "example.documents",
      assistantConfiguration: configuration(),
      isExtensionAvailable: async () => true,
      isCollectionDeclared: async () => true,
      persist,
      loadExisting: async ({ fileId, object, recordId }) => ({
        file: {
          id: fileId,
          name: "pliego.pdf",
          mime: "application/pdf",
          size: pdfBytes.byteLength,
          version: 1,
        },
        input: {
          object,
          recordId,
          filename: "pliego.pdf",
          content: pdfBytes,
          base64: pdfBase64,
          locale: "es",
        },
      }),
      fetchImpl,
    });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(persist).not.toHaveBeenCalled();
    expect(result.data.file.id).toBe("6f519c54-f669-4b2c-aed4-4a7999297bd2");
    expect(result.data.file.downloadUrl).toBe(
      "https://savia.test/v1/studio/101/api/file/6f519c54-f669-4b2c-aed4-4a7999297bd2/download",
    );
    expect(result.data.analysis).toBe("Retry analysis");
  });

  it("rejects collections that are not declared by the installed extension", async () => {
    const request = new Request(
      "https://savia.test/v1/studio/101/api/extensions/example.documents/document-analysis",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          object: "undeclared_records",
          recordId: "record-1",
          fileId: "6f519c54-f669-4b2c-aed4-4a7999297bd2",
        }),
      },
    );
    const loadExisting = vi.fn();
    const response = await handleStudioDocumentAnalysis({
      request,
      tenantId: 101,
      actor: { principal: { id: "member-1" } } as never,
      extensionId: "example.documents",
      assistantConfiguration: configuration(),
      isExtensionAvailable: async () => true,
      isCollectionDeclared: async (_extensionId, object) =>
        object === "declared_records",
      persist: vi.fn(),
      loadExisting,
    });

    expect(response.status).toBe(422);
    expect(loadExisting).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_DOCUMENT_TARGET" },
    });
  });
});
