import type { PluginApi } from "@savia/plugin-sdk";
export const DOSSIER_CONNECTOR = "secop-dossier";
export const DOSSIER_ORIGIN =
  "https://secop-live-worker.jose-douglas-dev.workers.dev";
export type Stored<T> = {
  id: string;
  revision: number;
  value: T;
  updatedAt: number;
};
export type Citation = {
  documentVersionId: string;
  page?: number;
  section?: string;
  excerpt: string;
};
export type DossierDocument = {
  name: string;
  state: string;
  url?: string | null;
  error?: string;
  expiresOn?: string;
  originalPurgedAt?: number;
};
export type Job = {
  id: string;
  state: string;
  kind?: string;
  error?: string | null;
  progress?: { result?: { conversationId?: string; assessmentId?: string } };
};
export type Requirement = {
  wording: string;
  category: string;
  mandatory: boolean;
  lot?: string | null;
  citations: Citation[];
};
export type Report = {
  corpusRevision: number;
  summary: string;
  requirementIds: string[];
  conflicts: string[];
  coverage: {
    total: number;
    indexed: number;
    pending: unknown[];
    reviewRequired: string[];
  };
};
export type DossierState = {
  dossier: Stored<{
    processId: string;
    corpusRevision: number;
    state: string;
    needsSynthesis?: boolean;
    description?: Record<string, unknown>;
  }> | null;
  documents: Stored<DossierDocument>[];
  documentTotal: number;
  report: Stored<Report> | null;
  requirements: Stored<Requirement>[];
  jobs: Job[];
  nextOffset: number | null;
};
export type Company = {
  name: string;
  legalId: string;
  activities: string;
  facts: Array<{
    field: string;
    value: number;
    unit: string;
    period: string | null;
    reviewed: boolean;
    citations: Citation[];
  }>;
};
export type CompanyDetail = {
  company: Stored<Company>;
  documents: Stored<DossierDocument>[];
  expiredDocumentIds: string[];
  jobs: Job[];
};
export type Assessment = Stored<{
  selectedLots: string[];
  findings: Array<{
    requirementId: string;
    mandatory: boolean;
    status: string;
    reason: string;
    missing: string[];
    companyCitations: Citation[];
  }>;
  readiness: string;
}> & {
  stale: boolean;
  readiness: string;
  reviews: Array<
    Stored<{ requirementId: string; decision: string; note: string }>
  >;
  priorReviews: unknown[];
};
export type Conversation = Stored<{
  title: string;
  turnIds: string[];
  pending?: unknown;
}> & {
  turns: Array<
    Stored<{
      userMessage: string;
      answer: string;
      citations: Citation[];
      stale: boolean;
      corpusRevision: number;
    }>
  >;
  nextCursor: number | null;
  previousCursor?: number | null;
};
export class DossierClient {
  constructor(
    readonly api: PluginApi,
    readonly connectionId: string,
  ) {}
  async call<T>(operation: string, input: Record<string, unknown>): Promise<T> {
    const result = await this.api.actions.execute<{
      status: number;
      data: { data?: T; error?: { code?: string } };
    }>("dossier-call", {
      connectionId: this.connectionId,
      input: { operation, arguments: input },
    });
    const response = result.output?.data;
    if (
      !response ||
      typeof response !== "object" ||
      response.error ||
      !Object.hasOwn(response, "data") ||
      !Number.isInteger(result.output?.status)
    )
      throw new Error(response?.error?.code ?? "INVALID_SERVICE_RESPONSE");
    return response.data as T;
  }
}
export function safeDossierUploadUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.origin === DOSSIER_ORIGIN &&
      url.pathname === "/private/upload" &&
      url.hash.startsWith("#ticket=") &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const dossierStateLabels = {
  es: {
    OCR_REQUIRED: "El PDF necesita OCR para extraer su texto",
    OCR_OR_FORMAT_UNAVAILABLE: "Este archivo necesita otro lector u OCR",
    HUMAN_HELP_REQUIRED: "SECOP requiere verificación manual",
    DOWNLOAD_UNAVAILABLE: "No se pudo descargar el archivo; puedes reintentar",
    EXTRACTION_RETRIES_EXHAUSTED: "La extracción agotó sus reintentos",
    pending: "Pendiente",
    queued: "En cola",
    running: "Procesando",
    succeeded: "Completado",
    failed: "Falló",
    cancelled: "Cancelado",
    ready: "Procesado",
    review_required: "Requiere revisión",
    blocked: "Necesita ayuda",
    processing: "Procesando",
    analyzed: "Analizado",
    partial: "Expediente parcial",
    new: "Sin preparar",
    deleted: "Eliminado",
    meets: "Cumple según evidencia",
    does_not_meet: "No cumple",
    insufficient_evidence: "Falta evidencia",
    not_applicable: "No aplica",
    requires_review: "Requiere revisión",
    missing_requirements: "Faltan requisitos",
    ready_for_user_review: "Listo para revisión del equipo",
    user_reviewed: "Con revisión del equipo",
  },
  en: {
    OCR_REQUIRED: "The PDF needs OCR to extract its text",
    OCR_OR_FORMAT_UNAVAILABLE: "This file needs another reader or OCR",
    HUMAN_HELP_REQUIRED: "SECOP requires manual verification",
    DOWNLOAD_UNAVAILABLE: "The file could not be downloaded; you can retry",
    EXTRACTION_RETRIES_EXHAUSTED: "Extraction retries were exhausted",
    pending: "Pending",
    queued: "Queued",
    running: "Processing",
    succeeded: "Complete",
    failed: "Failed",
    cancelled: "Cancelled",
    ready: "Processed",
    review_required: "Review required",
    blocked: "Needs help",
    processing: "Processing",
    analyzed: "Analyzed",
    partial: "Partial dossier",
    new: "Not prepared",
    deleted: "Deleted",
    meets: "Meets based on evidence",
    does_not_meet: "Does not meet",
    insufficient_evidence: "Evidence missing",
    not_applicable: "Not applicable",
    requires_review: "Review required",
    missing_requirements: "Requirements missing",
    ready_for_user_review: "Ready for team review",
    user_reviewed: "Reviewed by the team",
  },
  pt: {
    OCR_REQUIRED: "O PDF precisa de OCR para extrair o texto",
    OCR_OR_FORMAT_UNAVAILABLE: "Este arquivo precisa de outro leitor ou OCR",
    HUMAN_HELP_REQUIRED: "O SECOP exige verificação manual",
    DOWNLOAD_UNAVAILABLE:
      "Não foi possível baixar o arquivo; você pode tentar novamente",
    EXTRACTION_RETRIES_EXHAUSTED: "As tentativas de extração se esgotaram",
    pending: "Pendente",
    queued: "Na fila",
    running: "Processando",
    succeeded: "Concluído",
    failed: "Falhou",
    cancelled: "Cancelado",
    ready: "Processado",
    review_required: "Requer revisão",
    blocked: "Precisa de ajuda",
    processing: "Processando",
    analyzed: "Analisado",
    partial: "Dossiê parcial",
    new: "Não preparado",
    deleted: "Excluído",
    meets: "Atende segundo as evidências",
    does_not_meet: "Não atende",
    insufficient_evidence: "Falta evidência",
    not_applicable: "Não se aplica",
    requires_review: "Requer revisão",
    missing_requirements: "Faltam requisitos",
    ready_for_user_review: "Pronto para revisão da equipe",
    user_reviewed: "Revisado pela equipe",
  },
} satisfies Record<"es" | "en" | "pt", Record<string, string>>;

export function dossierStateLabel(
  value: string,
  locale: "es" | "en" | "pt" = "es",
) {
  const labels: Record<string, string> = dossierStateLabels[locale];
  return labels[value] ?? value;
}
