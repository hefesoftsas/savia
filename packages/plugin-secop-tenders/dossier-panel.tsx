import { useCallback, useEffect, useRef, useState } from "react";
import { DossierForm } from "./dossier-form";
import {
  ArrowLeft,
  FileText,
  ListChecks,
  Building2,
  MessageSquare,
  RefreshCw,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import type { PluginApi } from "@savia/plugin-sdk";
import { TenderDocuments } from "./tender-documents";
import { normalizeSecopRow, saveInterest, type SecopRow } from "./logic";
import {
  DossierClient,
  DOSSIER_CONNECTOR,
  safeDossierUploadUrl,
  dossierStateLabel,
  type DossierState,
  type CompanyDetail,
  type Company,
  type Stored,
  type Assessment,
  type Citation,
  type Job,
  type DossierDocument,
} from "./dossier";
import "./dossier-panel.css";
const tabs = [
  ["summary", "Resumen", FolderOpen],
  ["documents", "Documentos", FileText],
  ["requirements", "Requisitos", ListChecks],
  ["company", "Mi empresa", Building2],
  ["chat", "Asistente", MessageSquare],
] as const;
function CitationButtons({
  citations,
  onOpen,
}: {
  citations: Citation[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="secop-dossier-actions">
      {Array.from(
        new Map(
          citations.map((c) => [
            `${c.documentVersionId}:${c.page ?? c.section ?? ""}`,
            c,
          ]),
        ).values(),
      ).map((c, i) => (
        <button
          key={`${c.documentVersionId}:${i}`}
          type="button"
          onClick={() => onOpen(c.documentVersionId)}
        >
          Ver evidencia {i + 1}
          {c.page ? ` · pág. ${c.page}` : ""}
        </button>
      ))}
    </div>
  );
}
export function DossierPanel({
  savia,
  row,
  locale,
  onBack,
}: {
  savia: PluginApi;
  row: SecopRow;
  locale: "es" | "en" | "pt";
  onBack: () => void;
}) {
  const processId = String(row.process_id ?? "");
  const [legacy, setLegacy] = useState(false),
    [tab, setTab] = useState("summary");
  const [client, setClient] = useState<DossierClient | null>(null),
    [initializing, setInitializing] = useState(true),
    [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<DossierState | null>(null),
    [companies, setCompanies] = useState<Stored<Company>[]>([]),
    [companyId, setCompanyId] = useState(""),
    [detail, setDetail] = useState<CompanyDetail | null>(null),
    [assessment, setAssessment] = useState<Assessment | null>(null);
  const [pendingJob, setPendingJob] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uploadLink, setUploadLink] = useState<string | null>(null),
    [evidence, setEvidence] = useState<{
      document: Stored<DossierDocument>;
      chunks: Array<Stored<{ text: string; page?: number; section?: string }>>;
      nextOffset: number | null;
    } | null>(null);
  const [companyName, setCompanyName] = useState(""),
    [legalId, setLegalId] = useState(""),
    [activities, setActivities] = useState("");
  const snapshotRef = useRef<DossierState | null>(null);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const [selectedLotsText, setSelectedLotsText] = useState("");
  const sequence = useRef(0),
    alive = useRef(true),
    pollLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    let current = true;
    savia.connections
      .list()
      .then((list) => {
        if (current) {
          const connection = list.find(
            (c) => c.connectorId === DOSSIER_CONNECTOR,
          );
          if (connection)
            setClient(new DossierClient(savia, connection.connectionId));
        }
      })
      .catch(() => {
        if (current)
          setError(
            "No se pudo comprobar la conexión privada. Vuelve a abrir el expediente.",
          );
      })
      .finally(() => {
        if (current) setInitializing(false);
      });
    return () => {
      current = false;
      alive.current = false;
      sequence.current++;
    };
  }, [savia]);
  const refresh = useCallback(
    async (active = client) => {
      if (!active) return;
      const request = ++sequence.current;
      const [data, list] = await Promise.all([
        active.call<DossierState>("dossier", { id: processId, offset: 0 }),
        active.call<{ companies: Stored<Company>[] }>("companies", {
          offset: 0,
        }),
      ]);
      if (!alive.current || request !== sequence.current) return;
      if (
        !data ||
        !Array.isArray(data.documents) ||
        !Array.isArray(data.requirements) ||
        !Array.isArray(data.jobs) ||
        !Array.isArray(list?.companies)
      )
        throw new Error(
          "El servicio devolvió un expediente inválido. Reintenta Actualizar.",
        );
      const loaded = Math.max(
        snapshotRef.current?.documents.length ?? 0,
        snapshotRef.current?.requirements.length ?? 0,
      );
      for (
        let offset = 20;
        offset < loaded && data.nextOffset !== null;
        offset += 20
      ) {
        const next = await active.call<DossierState>("dossier", {
          id: processId,
          offset,
        });
        if (
          next.dossier?.value.corpusRevision !==
          data.dossier?.value.corpusRevision
        )
          throw new Error(
            "El expediente cambió durante la lectura. Actualiza para ver la nueva versión.",
          );
        data.documents.push(...next.documents);
        data.requirements.push(...next.requirements);
        data.nextOffset = next.nextOffset;
      }
      if (!alive.current || request !== sequence.current) return;
      setSnapshot(data);
      setCompanies(list.companies);
      const [company, fit] = await Promise.all([
        companyId
          ? active.call<CompanyDetail>("company-detail", { id: companyId })
          : Promise.resolve(null),
        companyId && data.dossier?.value.corpusRevision
          ? active.call<Assessment | null>("assessment", {
              dossierId: processId,
              companyId,
            })
          : Promise.resolve(null),
      ]);
      if (!alive.current || request !== sequence.current) return;
      setDetail(company);
      setAssessment(fit);
    },
    [client, companyId, processId],
  );
  useEffect(() => {
    setDetail(null);
    setAssessment(null);
    if (client)
      void refresh().catch(() => {
        if (alive.current)
          setError(
            "No se pudo cargar el expediente. Conservamos lo que ya estaba visible. Reintenta Actualizar.",
          );
      });
  }, [client, refresh]);
  const activeJobs =
    Boolean(pendingJob) ||
    snapshot?.jobs.some((j) => j.state === "queued" || j.state === "running") ||
    detail?.jobs.some((j) => j.state === "queued" || j.state === "running");
  useEffect(() => {
    if (!client || !activeJobs) return;
    const timer = setInterval(() => {
      if (pollLock.current) return;
      pollLock.current = true;
      void (async () => {
        if (pendingJob) {
          const job = await client.call<Job>("job", { id: pendingJob.id });
          if (!alive.current) return;
          if (["succeeded", "failed", "cancelled"].includes(job.state)) {
            setPendingJob(null);
            if (job.state === "failed")
              setError(
                `El trabajo requiere atención: ${job.error ?? "error de procesamiento"}. Puedes reintentarlo.`,
              );
            else
              setNotice(
                "El trabajo terminó. El expediente conserva sus resultados.",
              );
          } else setPendingJob(job);
        }
        await refresh();
      })()
        .catch(() => {
          if (alive.current)
            setError(
              "No pudimos actualizar el progreso. Tus archivos y trabajos permanecen guardados.",
            );
        })
        .finally(() => {
          pollLock.current = false;
        });
    }, 4000);
    return () => clearInterval(timer);
  }, [activeJobs, client, pendingJob, refresh]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "No se pudo completar la operación.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function prepare() {
    if (!client) return;
    await run(async () => {
      const normalized = normalizeSecopRow({
        ...row,
        id: String(row.source_id ?? row.id),
      });
      if (!normalized) throw new Error("No se pudo identificar la licitación.");
      await saveInterest(savia, normalized);
      const result = await client.call<{ job: Job }>("prepare", {
        processId,
        idempotencyKey: crypto.randomUUID(),
      });
      setPendingJob(result.job);
      setNotice(
        "Guardamos la licitación de interés. El expediente se prepara en segundo plano.",
      );
      await refresh();
    });
  }
  async function ticket(documentId?: string) {
    if (!client) return;
    await run(async () => {
      const result = await client.call<{ url: string }>(
        "upload-ticket",
        documentId ? { documentId } : { companyId },
      );
      const url = safeDossierUploadUrl(result.url);
      if (!url)
        throw new Error("El servicio devolvió un enlace de carga inválido.");
      setUploadLink(url);
    });
  }
  async function openEvidence(documentId: string) {
    if (!client) return;
    await run(async () => {
      setEvidence(await client.call("citation", { documentId, offset: 0 }));
    });
  }
  async function reviewDocument(doc: Stored<DossierDocument>) {
    if (!client) return;
    await run(async () => {
      await client.call("review-document", {
        documentId: doc.id,
        expectedRevision: doc.revision,
        note: "User confirmed the extraction against the original source.",
      });
      await refresh();
    });
  }
  async function createCompany() {
    if (!client) return;
    await run(async () => {
      const profile = await client.call<Stored<Company>>("company", {
        expectedRevision: 0,
        profile: { name: companyName, legalId, activities, facts: [] },
      });
      setCompanyId(profile.id);
      setCompanyName("");
      setLegalId("");
      setActivities("");
      setNotice(
        "Empresa creada. Agrega su evidencia para evaluar los requisitos.",
      );
    });
  }
  async function evaluate() {
    if (!client || !detail || !snapshot?.dossier) return;
    await run(async () => {
      const result = await client.call<{ job: Job }>("assess", {
        dossierId: processId,
        companyId,
        companyRevision: detail.company.revision,
        corpusRevision: snapshot.dossier!.value.corpusRevision,
        selectedLots: [
          ...new Set(
            selectedLotsText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
        idempotencyKey: crypto.randomUUID(),
      });
      setPendingJob(result.job);
    });
  }
  async function openAssistant(initialMessage?: string) {
    if (!client || !savia.assistant) {
      setError(
        "El chat de Savia necesita la actualización de la plataforma. Recarga la página cuando termine el despliegue.",
      );
      return;
    }
    await run(() =>
      savia.assistant!.open({
        title: String(row.name ?? "Expediente de la licitación"),
        actionId: "assistant-chat",
        connectionId: client.connectionId,
        context: {
          dossierId: processId,
          ...(companyId ? { companyProfileId: companyId } : {}),
        },
        ...(initialMessage ? { initialMessage } : {}),
      }),
    );
  }
  async function more() {
    if (!client || snapshot?.nextOffset == null) return;
    await run(async () => {
      const next = await client.call<DossierState>("dossier", {
        id: processId,
        offset: snapshot.nextOffset,
      });
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              documents: [
                ...previous.documents,
                ...next.documents.filter(
                  (d) => !previous.documents.some((x) => x.id === d.id),
                ),
              ],
              requirements: [
                ...previous.requirements,
                ...next.requirements.filter(
                  (r) => !previous.requirements.some((x) => x.id === r.id),
                ),
              ],
              nextOffset: next.nextOffset,
            }
          : next,
      );
    });
  }
  if (legacy)
    return (
      <TenderDocuments
        savia={savia}
        row={row}
        locale={locale}
        onBack={() => setLegacy(false)}
      />
    );
  const report = snapshot?.report?.value;
  const stale = Boolean(
    report &&
    snapshot?.dossier &&
    (report.corpusRevision !== snapshot.dossier.value.corpusRevision ||
      snapshot.dossier.value.needsSynthesis),
  );
  const selectedLots = [
    ...new Set(
      selectedLotsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort();
  const lotsMismatch = Boolean(
    assessment &&
    JSON.stringify([...(assessment.value.selectedLots ?? [])].sort()) !==
      JSON.stringify(selectedLots),
  );
  const documents = (docs: Stored<DossierDocument>[]) => (
    <ul className="secop-dossier-list">
      {docs.map((doc) => (
        <li key={doc.id}>
          <h3>{doc.value.name}</h3>
          <p className="secop-dossier-status">
            {dossierStateLabel(doc.value.state)}
            {doc.value.error ? ` · ${dossierStateLabel(doc.value.error)}` : ""}
          </p>
          <div className="secop-dossier-actions">
            <button
              type="button"
              disabled={
                busy || !["ready", "review_required"].includes(doc.value.state)
              }
              onClick={() => void openEvidence(doc.id)}
            >
              Ver texto y citas
            </button>
            {doc.value.url && (
              <a href={doc.value.url} target="_blank" rel="noopener noreferrer">
                Archivo oficial <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
            {["blocked", "failed"].includes(doc.value.state) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void ticket(doc.id)}
              >
                Aportar versión con texto
              </button>
            )}
            {doc.value.state === "review_required" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void reviewDocument(doc)}
              >
                Revisé la extracción completa
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <main className="secop-app secop-dossier" lang="es">
      <header className="secop-dossier-top">
        <div>
          <button type="button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" /> Volver a licitaciones
          </button>
          <p className="secop-eyebrow">EXPEDIENTE SECOP · {processId}</p>
          <h1>{String(row.name ?? "Expediente de la licitación")}</h1>
          <p className="secop-dossier-help">
            Documentos, requisitos y preparación de la oferta en un mismo lugar.
          </p>
        </div>
        {client && (
          <div className="secop-dossier-actions">
            <button
              type="button"
              disabled={busy || Boolean(activeJobs)}
              className="secop-primary"
              onClick={() => void prepare()}
            >
              {snapshot?.dossier
                ? "Actualizar expediente"
                : "Guardar y preparar expediente"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => refresh())}
            >
              <RefreshCw size={16} aria-hidden="true" /> Actualizar
            </button>
          </div>
        )}
      </header>
      {initializing && <p role="status">Comprobando conexión privada…</p>}
      {error && (
        <div className="secop-dossier-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="secop-dossier-notice" role="status">
          {notice}
        </p>
      )}
      {!initializing && !client && (
        <section>
          <h2>Conectar el asistente de expedientes</h2>
          <p className="secop-dossier-help">
            Usa la credencial privada de este espacio, distinta de la conexión
            pública de búsquedas SECOP. Se guardará como secreto en Savia.
          </p>
          <DossierForm
            onSubmit={() => {
              void run(async () => {
                await savia.connections.replace("secop-dossier", {
                  connectorId: DOSSIER_CONNECTOR,
                  values: { apiKey: token },
                });
                setToken("");
                setClient(new DossierClient(savia, "secop-dossier"));
              });
            }}
          >
            <label>
              Credencial del servicio
              <input
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <button disabled={busy} type="button" data-dossier-submit>
              Guardar conexión privada
            </button>
          </DossierForm>
          <button type="button" onClick={() => setLegacy(true)}>
            Ver documentos y análisis anteriores
          </button>
        </section>
      )}
      {client && (
        <>
          <div
            className="secop-tabs"
            role="tablist"
            aria-label="Expediente de la licitación"
          >
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                id={`dossier-tab-${id}`}
                role="tab"
                type="button"
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(event) => {
                  const index = tabs.findIndex((t) => t[0] === id);
                  const direction =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : direction
                          ? (index + direction + tabs.length) % tabs.length
                          : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    setTab(tabs[next][0]);
                    requestAnimationFrame(() =>
                      document
                        .getElementById(`dossier-tab-${tabs[next][0]}`)
                        ?.focus(),
                    );
                  }
                }}
                aria-selected={tab === id}
                aria-controls={`dossier-panel-${id}`}
                onClick={() => {
                  setTab(id);
                  setEvidence(null);
                  setUploadLink(null);
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {activeJobs && (
            <p className="secop-dossier-working" role="status">
              <RefreshCw size={16} aria-hidden="true" /> Procesando en segundo
              plano. Puedes salir y volver.
              {pendingJob && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await client.call("cancel", { id: pendingJob.id });
                      setPendingJob(null);
                      await refresh();
                    })
                  }
                >
                  Cancelar trabajo
                </button>
              )}
            </p>
          )}
          {uploadLink && (
            <div className="secop-dossier-notice">
              <a href={uploadLink} target="_blank" rel="noopener noreferrer">
                Abrir carga privada del documento{" "}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <p>
                El enlace admite una carga durante 10 minutos. Después de
                cargar, pulsa Actualizar.
              </p>
            </div>
          )}
          {evidence && (
            <aside
              className="secop-dossier-evidence"
              aria-label="Evidencia del documento"
            >
              <div className="secop-dossier-actions">
                <h2>{evidence.document.value.name}</h2>
                <button type="button" onClick={() => setEvidence(null)}>
                  Cerrar evidencia
                </button>
              </div>
              {evidence.chunks.map((chunk) => (
                <blockquote key={chunk.id}>
                  <strong>
                    {chunk.value.page
                      ? `Página ${chunk.value.page}`
                      : (chunk.value.section ?? "Sección")}
                  </strong>
                  <p>{chunk.value.text}</p>
                </blockquote>
              ))}
              {evidence.nextOffset !== null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = await client.call<typeof evidence>(
                        "citation",
                        {
                          documentId: evidence.document.id,
                          offset: evidence.nextOffset,
                        },
                      );
                      setEvidence({
                        ...next,
                        chunks: [...evidence.chunks, ...next.chunks],
                      });
                    })
                  }
                >
                  Cargar más texto
                </button>
              )}
            </aside>
          )}
          <section
            role="tabpanel"
            id={`dossier-panel-${tab}`}
            aria-labelledby={`dossier-tab-${tab}`}
          >
            {tab === "summary" && (
              <>
                {!snapshot?.dossier ? (
                  <div className="secop-dossier-notice">
                    <h2>Prepara el expediente completo</h2>
                    <p>
                      Guardaremos la licitación de interés y revisaremos la
                      descripción, pliegos, anexos y adendas disponibles. Verás
                      qué archivos se procesaron y qué falta.
                    </p>
                  </div>
                ) : (
                  <>
                    <dl className="secop-dossier-summary">
                      <div>
                        <dt>Análisis conjunto</dt>
                        <dd>
                          {snapshot.dossier.value.needsSynthesis
                            ? "Pendiente de actualizar"
                            : report
                              ? "Completado"
                              : dossierStateLabel(snapshot.dossier.value.state)}
                        </dd>
                      </div>
                      <div>
                        <dt>Documentos del catálogo</dt>
                        <dd>{snapshot.documentTotal}</dd>
                      </div>
                      <div>
                        <dt>Documentos analizados</dt>
                        <dd>{report?.coverage.indexed ?? "En preparación"}</dd>
                      </div>
                      <div>
                        <dt>Versión del expediente</dt>
                        <dd>{snapshot.dossier.value.corpusRevision}</dd>
                      </div>
                    </dl>
                    <p className="secop-dossier-help">
                      Cobertura del catálogo público disponible en SECOP. Los
                      archivos bloqueados, faltantes o sin extraer permanecen
                      pendientes.
                    </p>
                  </>
                )}
                {stale && (
                  <p className="secop-dossier-notice">
                    El expediente cambió. El informe anterior se conserva y
                    requiere actualización.
                  </p>
                )}
                {report && (
                  <>
                    <div className="secop-dossier-section-heading">
                      <h2>Resumen del expediente</h2>
                      <button type="button" onClick={() => setTab("chat")}>
                        <ListChecks size={16} aria-hidden="true" /> Ver lista
                        completa
                      </button>
                    </div>
                    <div className="secop-dossier-text">{report.summary}</div>
                    {(report.coverage.pending.length > 0 ||
                      report.coverage.reviewRequired.length > 0) && (
                      <p className="secop-dossier-notice">
                        Revisión de fuentes pendiente:{" "}
                        {report.coverage.pending.length} documentos sin extraer
                        y {report.coverage.reviewRequired.length} extracciones
                        por revisar. El análisis conjunto y la revisión humana
                        son pasos distintos.
                      </p>
                    )}
                    {report.conflicts.length > 0 && (
                      <>
                        <h2>Conflictos y adendas por revisar</h2>
                        <ul>
                          {report.conflicts.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
                {snapshot?.jobs.some((job) => job.state === "failed") && (
                  <details className="secop-dossier-job-history">
                    <summary>Historial de incidencias de procesamiento</summary>
                    {snapshot?.jobs
                      .filter((j) => j.state === "failed")
                      .map((job) => (
                        <div key={job.id} className="secop-dossier-notice">
                          <p>
                            Trabajo pendiente de resolver:{" "}
                            {dossierStateLabel(
                              job.error ?? job.kind ?? "failed",
                            )}
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const next = await client.call<Job>("retry", {
                                  jobId: job.id,
                                });
                                setPendingJob(next);
                              })
                            }
                          >
                            Reintentar trabajo
                          </button>
                        </div>
                      ))}
                  </details>
                )}
              </>
            )}
            {tab === "documents" && (
              <>
                <h2>Documentos del expediente</h2>
                <p className="secop-dossier-help">
                  Mostrando {snapshot?.documents.length ?? 0} de{" "}
                  {snapshot?.documentTotal ?? 0}. Un CAPTCHA requiere tu ayuda;
                  no se omiten archivos en silencio. Confirma una extracción
                  solo después de compararla con el original.
                </p>
                {documents(snapshot?.documents ?? [])}
                {snapshot?.nextOffset !== null &&
                  snapshot?.nextOffset !== undefined && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void more()}
                    >
                      Cargar más documentos y requisitos
                    </button>
                  )}
                <div className="secop-dossier-actions">
                  <button type="button" onClick={() => setLegacy(true)}>
                    Documentos públicos y análisis anteriores por PDF
                  </button>
                </div>
              </>
            )}
            {tab === "requirements" && (
              <>
                <h2>Requisitos con fuente</h2>
                {!report && (
                  <p>
                    Prepara el expediente para extraer los requisitos conjuntos.
                  </p>
                )}
                <ul className="secop-dossier-list">
                  {snapshot?.requirements.map((req) => (
                    <li key={req.id}>
                      <p className="secop-dossier-status">
                        {req.value.category} ·{" "}
                        {req.value.mandatory
                          ? "Obligatorio"
                          : "Informativo o puntuable"}
                        {req.value.lot ? ` · Lote ${req.value.lot}` : ""}
                      </p>
                      <h3>{req.value.wording}</h3>
                      <CitationButtons
                        citations={req.value.citations}
                        onOpen={(id) => void openEvidence(id)}
                      />
                    </li>
                  ))}
                </ul>
                {snapshot?.nextOffset !== null &&
                  snapshot?.nextOffset !== undefined && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void more()}
                    >
                      Cargar más requisitos
                    </button>
                  )}
              </>
            )}
            {tab === "company" && (
              <>
                <h2>Evaluar mi empresa</h2>
                <label>
                  Lotes a evaluar (opcional)
                  <input
                    value={selectedLotsText}
                    onChange={(event) =>
                      setSelectedLotsText(event.target.value)
                    }
                    placeholder="Identificadores de lote separados por comas"
                  />
                </label>
                <p className="secop-dossier-help">
                  En blanco se revisan todos los lotes. Usa los identificadores
                  que aparecen en los requisitos.
                </p>
                <label>
                  Empresa
                  <select
                    value={companyId}
                    onChange={(event) => {
                      setCompanyId(event.target.value);
                      setUploadLink(null);
                    }}
                  >
                    <option value="">Selecciona una empresa</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.value.name}
                      </option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>Crear perfil de empresa</summary>
                  <DossierForm onSubmit={() => void createCompany()}>
                    <label>
                      Nombre de la empresa
                      <input
                        required
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                      />
                    </label>
                    <label>
                      Identificación tributaria
                      <input
                        value={legalId}
                        onChange={(event) => setLegalId(event.target.value)}
                      />
                    </label>
                    <label>
                      Actividad y capacidades
                      <textarea
                        value={activities}
                        onChange={(event) => setActivities(event.target.value)}
                      />
                    </label>
                    <button type="button" data-dossier-submit disabled={busy}>
                      Crear empresa
                    </button>
                  </DossierForm>
                </details>
                {detail && (
                  <>
                    <div className="secop-dossier-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void ticket()}
                      >
                        Agregar evidencia de empresa
                      </button>
                      <button
                        type="button"
                        className="secop-primary"
                        disabled={
                          busy || Boolean(activeJobs) || !report || stale
                        }
                        onClick={() => void evaluate()}
                      >
                        Evaluar cumplimiento
                      </button>
                    </div>
                    <p className="secop-dossier-help">
                      Agrega certificados de experiencia, registros y estados
                      financieros. Lo declarado en el perfil no reemplaza los
                      documentos probatorios. Esta evaluación prepara la oferta;
                      no presenta una postulación.
                    </p>
                    {documents(detail.documents)}
                    {detail.company.value.facts.length > 0 && (
                      <>
                        <h2>Datos extraídos de la empresa</h2>
                        <p className="secop-dossier-help">
                          Confirma las cifras, unidades y períodos contra la
                          fuente antes de usarlos en comparaciones numéricas.
                        </p>
                        <ul className="secop-dossier-list">
                          {detail.company.value.facts.map((fact, index) => (
                            <li key={index}>
                              <strong>
                                {fact.field}: {fact.value} {fact.unit}
                                {fact.period ? ` · ${fact.period}` : ""}
                              </strong>
                              <CitationButtons
                                citations={fact.citations}
                                onOpen={(id) => void openEvidence(id)}
                              />
                              {fact.reviewed ? (
                                <p>Dato revisado</p>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await client.call("company-fact-review", {
                                        companyId,
                                        index,
                                        expectedRevision:
                                          detail.company.revision,
                                        note: "User checked the extracted figure against the cited original.",
                                      });
                                      await refresh();
                                    })
                                  }
                                >
                                  Confirmo este dato y su evidencia
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {assessment && (
                      <>
                        <h2>
                          {dossierStateLabel(
                            lotsMismatch
                              ? "requires_review"
                              : assessment.readiness,
                          )}
                        </h2>
                        {(assessment.stale || lotsMismatch) && (
                          <p className="secop-dossier-notice">
                            La empresa, sus evidencias o el expediente
                            cambiaron. Vuelve a evaluar.
                          </p>
                        )}
                        {assessment.priorReviews?.length > 0 && (
                          <p>
                            Se conservan revisiones anteriores para volver a
                            comprobarlas con estas fuentes.
                          </p>
                        )}
                        <ul className="secop-dossier-list">
                          {assessment.value.findings.map((finding) => (
                            <li key={finding.requirementId}>
                              <h3>{dossierStateLabel(finding.status)}</h3>
                              <p>
                                {snapshot?.requirements.find(
                                  (r) => r.id === finding.requirementId,
                                )?.value.wording ?? finding.requirementId}
                              </p>
                              <p>{finding.reason}</p>
                              {finding.missing.length > 0 && (
                                <>
                                  <strong>Qué falta para aplicar</strong>
                                  <ul>
                                    {finding.missing.map((missing, i) => (
                                      <li key={i}>{missing}</li>
                                    ))}
                                  </ul>
                                </>
                              )}
                              <CitationButtons
                                citations={finding.companyCitations}
                                onOpen={(id) => void openEvidence(id)}
                              />
                              {assessment.reviews
                                .filter(
                                  (review) =>
                                    review.value.requirementId ===
                                    finding.requirementId,
                                )
                                .map((review) => (
                                  <p key={review.id}>
                                    <strong>Revisión del equipo:</strong>{" "}
                                    {dossierStateLabel(review.value.decision)} ·{" "}
                                    {review.value.note}
                                  </p>
                                ))}
                              <details>
                                <summary>Registrar revisión del equipo</summary>
                                <DossierForm
                                  onSubmit={(form) => {
                                    const data = new FormData(form);
                                    void run(async () => {
                                      await client.call("review-finding", {
                                        assessmentId: assessment.id,
                                        requirementId: finding.requirementId,
                                        expectedRevision: assessment.revision,
                                        decision: String(data.get("decision")),
                                        note: String(data.get("note")),
                                      });
                                      await refresh();
                                    });
                                  }}
                                >
                                  <label>
                                    Decisión
                                    <select
                                      name="decision"
                                      defaultValue="insufficient_evidence"
                                    >
                                      <option value="insufficient_evidence">
                                        Falta evidencia
                                      </option>
                                      <option value="meets">
                                        Cumple según revisión del equipo
                                      </option>
                                      <option value="does_not_meet">
                                        No cumple
                                      </option>
                                      <option value="not_applicable">
                                        No aplica
                                      </option>
                                    </select>
                                  </label>
                                  <label>
                                    Justificación
                                    <textarea
                                      name="note"
                                      required
                                      minLength={3}
                                      maxLength={2000}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    data-dossier-submit
                                    disabled={busy}
                                  >
                                    Guardar revisión
                                  </button>
                                </DossierForm>
                              </details>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {tab === "chat" && (
              <div className="secop-dossier-assistant-entry">
                <div>
                  <MessageSquare size={24} aria-hidden="true" />
                  <h2>Esta licitación, en el chat de Savia</h2>
                  <p className="secop-dossier-help">
                    Continúa la conversación con las fuentes de este expediente.
                    La licitación y la empresa seleccionadas acompañan cada
                    pregunta.
                  </p>
                </div>
                <label>
                  Empresa para contrastar requisitos
                  <select
                    value={companyId}
                    onChange={(event) => setCompanyId(event.target.value)}
                  >
                    <option value="">Solo la licitación</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.value.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="secop-dossier-actions">
                  <button
                    type="button"
                    className="secop-primary"
                    disabled={busy || !report || !savia.assistant}
                    onClick={() => void openAssistant()}
                  >
                    <MessageSquare size={16} aria-hidden="true" /> Abrir chat de
                    Savia
                  </button>
                  <button
                    type="button"
                    disabled={busy || !report || !savia.assistant}
                    onClick={() =>
                      void openAssistant(
                        "Prepara la lista completa de todos los requisitos y documentos para aplicar a esta licitación, con evidencia por punto y todo lo que falta por verificar.",
                      )
                    }
                  >
                    <ListChecks size={16} aria-hidden="true" /> Preparar lista
                    completa
                  </button>
                </div>
                {!companyId && (
                  <p className="secop-dossier-help">
                    Aún no contrastamos el cumplimiento de tu empresa.
                    Selecciona su perfil y aporta evidencias en «Mi empresa».
                  </p>
                )}
                {report &&
                  (report.coverage.pending.length > 0 ||
                    report.coverage.reviewRequired.length > 0) && (
                    <p className="secop-dossier-notice">
                      {report.coverage.pending.length > 0
                        ? `${report.coverage.pending.length} documentos siguen pendientes de extracción. `
                        : "Todos los documentos disponibles tienen texto extraído. "}
                      {report.coverage.reviewRequired.length} extracciones
                      requieren revisión contra el original. El análisis
                      automático no confirma cumplimiento.
                    </p>
                  )}
                {!report && (
                  <p className="secop-dossier-help">
                    Primero prepara el expediente para conversar con sus
                    documentos.
                  </p>
                )}
                {!savia.assistant && (
                  <p role="status" className="secop-dossier-notice">
                    El chat integrado estará disponible al actualizar la
                    plataforma. Tus conversaciones permanecen guardadas en el
                    servicio.
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
