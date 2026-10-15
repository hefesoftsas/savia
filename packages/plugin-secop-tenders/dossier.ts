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
      data?: T;
      error?: { code?: string };
    }>("dossier-call", {
      connectionId: this.connectionId,
      input: { operation, arguments: input },
    });
    if (
      !result.output ||
      result.output.error ||
      !Object.hasOwn(result.output, "data")
    )
      throw new Error(result.output?.error?.code ?? "INVALID_SERVICE_RESPONSE");
    return result.output.data as T;
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
export function dossierStateLabel(value: string) {
  return (
    (
      {
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
      } as Record<string, string>
    )[value] ?? value
  );
}
