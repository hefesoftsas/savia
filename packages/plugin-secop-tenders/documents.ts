import type { PluginApi } from "@savia/plugin-sdk";
export const DOCUMENTS_COLLECTION = "procurement_documents";
export type TenderDocument = {
  id: string;
  name: string;
  url: string;
  kind: ReturnType<typeof documentKind>;
  date: string;
  size: number;
  processId: string;
};
export function documentKind(name: string) {
  const value = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /pliego|invitacion/.test(value)
    ? "specification"
    : /adenda/.test(value)
      ? "amendment"
      : /anexo/.test(value)
        ? "annex"
        : "other";
}
export function normalizeTenderDocument(
  value: unknown,
  processId: string,
): TenderDocument | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    row.id_del_proceso !== processId ||
    !/^\d+$/.test(String(row.id_documento ?? ""))
  )
    return null;
  const field = row.url_descarga_documento;
  const raw =
    field && typeof field === "object"
      ? (field as { url?: unknown }).url
      : field;
  try {
    const url = new URL(String(raw));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "community.secop.gov.co" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/Public/Archive/RetrieveFile/Index" ||
      url.searchParams.get("DocumentId") !== String(row.id_documento)
    )
      return null;
    const name = String(row.nombre_archivo ?? "")
      .trim()
      .slice(0, 500);
    if (!name) return null;
    return {
      id: String(row.id_documento),
      name,
      url: url.href,
      kind: documentKind(name),
      date: String(row.fecha_carga ?? ""),
      size: Math.max(0, Number(row.tamanno_archivo) || 0),
      processId,
    };
  } catch {
    return null;
  }
}
export async function loadTenderDocuments(
  api: PluginApi,
  processId: string,
  page = 1,
) {
  if (!/^CO1\.REQ\.\d+$/.test(processId))
    throw new Error("Invalid process identity");
  const result = await api.actions.execute<{
    data?: unknown[];
    hasNext?: boolean;
  }>("documents", { input: { id_del_proceso: processId, page, perPage: 20 } });
  const output = result.output;
  if (!output || !Array.isArray(output.data))
    throw new Error("Invalid document response");
  const rows = output.data.map((row) =>
    normalizeTenderDocument(row, processId),
  );
  if (rows.some((row) => row === null))
    throw new Error("Unverified document association");
  const data = rows as TenderDocument[];
  return {
    data: [...new Map(data.map((row) => [row.id, row])).values()],
    hasNext:
      typeof output.hasNext === "boolean" ? output.hasNext : data.length === 20,
  };
}
export async function pdfBase64(file: File) {
  if (!file.size || file.size > 5 * 1024 * 1024 || !/\.pdf$/i.test(file.name))
    throw new Error("Select a PDF up to 5 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    throw new Error("The selected file is not a PDF");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export type DocumentAnalysis = {
  file: { id: string; name: string };
  analysis: string;
  model: string;
  analyzedAt: string;
};
export async function analyzeTenderPdf(
  input: {
    recordId: string;
    locale: string;
    sourceUrl?: string;
    opportunityContext?: string;
  } & ({ filename: string; data: string } | { fileId: string }),
) {
  const response = await fetch(
    "/api/extensions/procurement.secop/document-analysis",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "procurement_opportunities", ...input }),
    },
  );
  const payload = (await response.json()) as {
    data?: DocumentAnalysis;
    error?: { code?: string; message?: string; fileId?: string } | string;
  };
  if (!response.ok || !payload.data)
    throw Object.assign(new Error("Document analysis failed"), {
      code: typeof payload.error === "object" ? payload.error?.code : undefined,
      fileId:
        typeof payload.error === "object" ? payload.error?.fileId : undefined,
      status: response.status,
    });
  return payload.data;
}

/** Saved attachments stay on the authenticated host, including local HTTP development. */
export function safeStoredFileUrl(
  value: unknown,
  origin: string,
): string | null {
  try {
    const url = new URL(String(value));
    if (url.origin !== origin || url.username || url.password) return null;
    return url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
