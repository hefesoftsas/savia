import { describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import {
  loadTenderDocuments,
  normalizeTenderDocument,
  pdfBase64,
  documentKind,
  safeStoredFileUrl,
} from "../documents";
const url =
  "https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=123&InCommunity=False";
const row = {
  id_documento: "123",
  id_del_proceso: "CO1.REQ.123",
  nombre_archivo: "Pliego definitivo.pdf",
  url_descarga_documento: { url },
  fecha_carga: "2026-10-14",
  tamanno_archivo: "1234",
};
describe("tender documents", () => {
  it("retains verified process identity and the official download URL", () => {
    expect(normalizeTenderDocument(row, "CO1.REQ.123")).toMatchObject({
      id: "123",
      url,
      name: "Pliego definitivo.pdf",
      kind: "specification",
    });
  });
  it("rejects documents from other or unverified processes and unsafe links", () => {
    for (const patch of [
      { id_del_proceso: "CO1.REQ.999" },
      { id_del_proceso: undefined },
      { url_descarga_documento: { url: "https://example.com/file.pdf" } },
      {
        url_descarga_documento: {
          url: "https://community.secop.gov.co/STS/Users/Login/Index",
        },
      },
      { url_descarga_documento: { url: "javascript:alert(1)" } },
    ])
      expect(
        normalizeTenderDocument({ ...row, ...patch }, "CO1.REQ.123"),
      ).toBeNull();
  });
  it("loads a fixed paged MCP action and refuses malformed responses", async () => {
    const execute = vi.fn().mockResolvedValue({
      output: { data: [{ ...row, id: "123" }], hasNext: true },
    });
    const api = { actions: { execute } } as unknown as PluginApi;
    expect(await loadTenderDocuments(api, "CO1.REQ.123", 2)).toMatchObject({
      data: [{ id: "123" }],
      hasNext: true,
    });
    expect(execute).toHaveBeenCalledWith("documents", {
      input: { id_del_proceso: "CO1.REQ.123", page: 2, perPage: 20 },
    });
    execute.mockResolvedValue({
      output: { data: [{ ...row, id_del_proceso: "CO1.REQ.999" }] },
    });
    await expect(loadTenderDocuments(api, "CO1.REQ.123", 1)).rejects.toThrow();
  });
  it("classifies common annexes and amendments without claiming all files are specifications", () => {
    expect(documentKind("ANEXO técnico.pdf")).toBe("annex");
    expect(documentKind("Adenda 2.pdf")).toBe("amendment");
    expect(documentKind("CDP.pdf")).toBe("other");
  });
  it("validates PDF bytes and size before encoding a selected upload", async () => {
    const file = new File(["%PDF-1.7\nexample"], "pliego.pdf", {
      type: "application/pdf",
    });
    expect(await pdfBase64(file)).toBe(btoa("%PDF-1.7\nexample"));
    await expect(
      pdfBase64(new File(["<html>captcha</html>"], "pliego.pdf")),
    ).rejects.toThrow();
    await expect(
      pdfBase64(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.pdf")),
    ).rejects.toThrow();
  });
});

it("retains authenticated local HTTP downloads and rejects foreign attachment origins", () => {
  expect(
    safeStoredFileUrl(
      "http://localhost:5173/v1/studio/12/api/file/file1/download",
      "http://localhost:5173",
    ),
  ).toBe("http://localhost:5173/v1/studio/12/api/file/file1/download");
  expect(
    safeStoredFileUrl(
      "http://localhost:5173/file",
      "https://savia-preview.hefesoft.com",
    ),
  ).toBeNull();
  expect(
    safeStoredFileUrl("http://example.com/file", "http://example.com"),
  ).toBeNull();
});
