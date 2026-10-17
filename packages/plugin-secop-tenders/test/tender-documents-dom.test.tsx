/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/plugin-sdk";
import { TenderDocuments } from "../tender-documents";
import { analyzeTenderPdf, pdfBase64 } from "../documents";
vi.mock("../documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../documents")>()),
  analyzeTenderPdf: vi.fn(),
  pdfBase64: vi.fn().mockResolvedValue("JVBERi0="),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  vi.clearAllMocks();
  vi.mocked(analyzeTenderPdf).mockReset();
});
const documentRow = {
  id_documento: "123",
  id_del_proceso: "CO1.REQ.123",
  nombre_archivo: "Pliego definitivo.pdf",
  url_descarga_documento: {
    url: "https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=123",
  },
};
async function mount(
  output: unknown = { data: [documentRow], hasNext: false },
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const execute = vi.fn().mockResolvedValue({ output });
  const reports = {
    list: vi.fn().mockResolvedValue({ data: [] }),
    create: vi
      .fn()
      .mockImplementation(async (data) => ({ id: "report-1", ...data })),
  };
  const interests = {
    list: vi.fn().mockResolvedValue({
      data: [{ id: "interest-1", source_id: "source-1" }],
    }),
  };
  const savia = {
    actions: { execute },
    collections: {
      collection: (name: string) =>
        name === "procurement_documents" ? reports : interests,
    },
  } as unknown as PluginApi;
  const back = vi.fn();
  await act(async () =>
    root.render(
      <TenderDocuments
        savia={savia}
        row={{
          id: "source-1",
          process_id: "CO1.REQ.123",
          name: "Software tender",
          entity: "Entity",
        }}
        locale="es"
        onBack={back}
      />,
    ),
  );
  return { execute, reports, interests, back };
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (el) => el.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
describe("tender documents UI", () => {
  it("loads documents only for the selected process and exposes the official download plus accessible tabs", async () => {
    const { execute, back } = await mount();
    expect(execute).toHaveBeenCalledWith("documents", {
      input: { id_del_proceso: "CO1.REQ.123", page: 1, perPage: 20 },
    });
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href*="RetrieveFile"]',
    )!;
    expect(link.target).toBe("_blank");
    expect(link.getAttribute("aria-label")).toBe("Descargar en SECOP");
    expect(link.title).toBe("Descargar en SECOP");
    expect(link.querySelector("svg")).not.toBeNull();
    const backButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Volver a licitaciones"]',
    )!;
    expect(backButton.textContent).toBe("");
    await act(async () => backButton.click());
    expect(back).toHaveBeenCalledOnce();
    expect(
      host.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toBe("Documentos");
    await click("Resumen");
    expect(host.querySelector('[role="tabpanel"]')?.id).toBe(
      "secop-overview-panel",
    );
  });
  it("keeps a failed document lookup actionable and does not fabricate files", async () => {
    await mount({ data: [{ ...documentRow, id_del_proceso: "CO1.REQ.999" }] });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "No se pudieron cargar",
    );
    expect(host.querySelector('a[href*="RetrieveFile"]')).toBeNull();
  });
  it("analyzes selected PDF bytes and persists a report tied to the saved interest", async () => {
    const { reports } = await mount();
    vi.mocked(analyzeTenderPdf).mockResolvedValue({
      file: { id: "file-1", name: "pliego.pdf" },
      analysis: "Experience: see page 3.",
      model: "configured/model",
      analyzedAt: "2026-10-15T01:00:00Z",
    });
    await click("Analizar un PDF descargado");
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [
        new File(["%PDF-1.7"], "pliego.pdf", { type: "application/pdf" }),
      ],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Guardar interés y analizar PDF",
      )?.type,
    ).toBe("button");
    await click("Guardar interés y analizar PDF");
    expect(pdfBase64).toHaveBeenCalled();
    expect(analyzeTenderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: "interest-1",
        data: "JVBERi0=",
      }),
    );
    expect(reports.create).toHaveBeenCalledWith(
      expect.objectContaining({
        process_id: "CO1.REQ.123",
        interest_id: "interest-1",
        document_id: "",
        analysis: "Experience: see page 3.",
      }),
    );
    expect(host.textContent).toContain("Experience: see page 3.");
  });
  it("downloads and analyzes the official PDF on one click without requesting a file", async () => {
    const { reports } = await mount();
    vi.mocked(analyzeTenderPdf).mockResolvedValue({
      file: { id: "file-remote", name: "Pliego definitivo.pdf" },
      analysis: "Remote PDF requirements",
      model: "configured/model",
      analyzedAt: "2026-10-15T01:00:00Z",
    });
    await click("Analizar este PDF");
    expect(analyzeTenderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: "interest-1",
        downloadUrl: documentRow.url_descarga_documento.url,
        filename: "Pliego definitivo.pdf",
        sourceUrl: documentRow.url_descarga_documento.url,
      }),
    );
    expect(pdfBase64).not.toHaveBeenCalled();
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(reports.create).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: "123",
        analysis: "Remote PDF requirements",
      }),
    );
  });
  it("requests help only after an access challenge and preserves the selected official document", async () => {
    const { reports } = await mount();
    vi.mocked(analyzeTenderPdf).mockRejectedValueOnce(
      Object.assign(new Error("challenge"), {
        code: "DOCUMENT_ACCESS_CHALLENGE",
      }),
    );
    await click("Analizar este PDF");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "CAPTCHA",
    );
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[role="alert"]'));
    expect(reports.create).not.toHaveBeenCalled();
    const link = host.querySelector<HTMLAnchorElement>('[role="alert"] a');
    expect(link?.href).toBe(documentRow.url_descarga_documento.url);
    vi.mocked(analyzeTenderPdf).mockResolvedValue({
      file: { id: "file-retry", name: "pliego.pdf" },
      analysis: "Retried",
      model: "model",
      analyzedAt: "2026-10-15T01:00:00Z",
    });
    await click("Reintentar descarga automática");
    expect(reports.create).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: "123", analysis: "Retried" }),
    );
  });
  it("retries an AI failure using the stored file instead of downloading another copy", async () => {
    await mount();
    vi.mocked(analyzeTenderPdf).mockRejectedValueOnce(
      Object.assign(new Error("AI unavailable"), {
        code: "ANALYSIS_PROVIDER_UNAVAILABLE",
        fileId: "saved-file-1",
      }),
    );
    await click("Analizar este PDF");
    expect(host.querySelector('input[type="file"]')).toBeNull();
    vi.mocked(analyzeTenderPdf).mockResolvedValue({
      file: { id: "saved-file-1", name: "Pliego definitivo.pdf" },
      analysis: "Recovered",
      model: "model",
      analyzedAt: "2026-10-15T01:00:00Z",
    });
    await click("Reintentar descarga automática");
    expect(vi.mocked(analyzeTenderPdf).mock.calls[1][0]).toEqual(
      expect.objectContaining({
        fileId: "saved-file-1",
        recordId: "interest-1",
      }),
    );
    expect(vi.mocked(analyzeTenderPdf).mock.calls[1][0]).not.toHaveProperty(
      "downloadUrl",
    );
    expect(host.textContent).toContain("Recovered");
  });
  it("keeps a failed download retryable without requesting a manual upload", async () => {
    const { reports } = await mount();
    vi.mocked(analyzeTenderPdf).mockRejectedValueOnce(
      Object.assign(new Error("unavailable"), {
        code: "DOCUMENT_DOWNLOAD_FAILED",
      }),
    );
    await click("Analizar este PDF");
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "descargar",
    );
    expect(reports.create).not.toHaveBeenCalled();
  });
  it("downloads non-PDF attachments without offering unsupported automatic analysis", async () => {
    await mount({
      data: [{ ...documentRow, nombre_archivo: "Anexo financiero.xlsx" }],
      hasNext: false,
    });
    expect(host.querySelector('a[href*="RetrieveFile"]')).not.toBeNull();
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === "Analizar este PDF",
      ),
    ).toBe(false);
  });
  it("preserves the PDF suffix while fitting long catalog names into the analysis API", async () => {
    await mount({
      data: [{ ...documentRow, nombre_archivo: "a".repeat(300) + ".PDF" }],
      hasNext: false,
    });
    vi.mocked(analyzeTenderPdf).mockResolvedValue({
      file: { id: "long", name: "short.pdf" },
      analysis: "Long name supported",
      model: "model",
      analyzedAt: "2026-10-15T01:00:00Z",
    });
    await click("Analizar este PDF");
    const input = vi.mocked(analyzeTenderPdf).mock.calls[0][0];
    expect("filename" in input && input.filename.length).toBeLessThanOrEqual(
      200,
    );
    expect("filename" in input && input.filename).toMatch(/\.pdf$/i);
    expect(input).toHaveProperty(
      "downloadUrl",
      documentRow.url_descarga_documento.url,
    );
  });
  it("retains a completed analysis when saving fails, allowing a persistence retry", async () => {
    const { reports } = await mount();
    reports.create.mockRejectedValueOnce(new Error("offline"));
    vi.mocked(analyzeTenderPdf).mockResolvedValue({
      file: { id: "file-1", name: "pliego.pdf" },
      analysis: "Retained analysis",
      model: "configured/model",
      analyzedAt: "2026-10-15T01:00:00Z",
    });
    await click("Analizar un PDF descargado");
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File(["%PDF-1.7"], "pliego.pdf")],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await click("Guardar interés y analizar PDF");
    expect(host.textContent).toContain("Retained analysis");
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    await click("Guardar resultado");
    expect(host.textContent).toContain("Retained analysis");
    expect(reports.create).toHaveBeenCalledTimes(2);
  });
});
