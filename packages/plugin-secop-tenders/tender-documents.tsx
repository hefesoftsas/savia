import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import type { PluginApi } from "@savia/plugin-sdk";
import { normalizeSecopRow, saveInterest, type SecopRow } from "./logic";
import {
  analyzeTenderPdf,
  safeStoredFileUrl,
  DOCUMENTS_COLLECTION,
  loadTenderDocuments,
  documentBase64,
  isSupportedDocumentName,
  type TenderDocument,
  type DocumentAnalysis,
} from "./documents";
import "./tender-documents.css";
const copy = {
  es: {
    back: "Volver a licitaciones",
    overview: "Resumen",
    documents: "Documentos",
    load: "Cargando documentos del proceso…",
    empty:
      "No hay documentos vinculados a este expediente en el catálogo público. Puedes consultar SECOP y analizar un documento descargado (PDF, DOCX o XLSX).",
    error:
      "No se pudieron cargar los documentos. Reintenta o consulta el expediente en SECOP.",
    retry: "Reintentar",
    more: "Cargar más documentos",
    download: "Descargar en SECOP",
    analyze: "Analizar documento",
    upload: "Analizar un documento descargado",
    hint: "Analizar el documento descarga el archivo oficial y guarda el análisis automáticamente. Solo se analiza el contenido del archivo (PDF, DOCX o XLSX), nunca el enlace ni su nombre.",
    challenge:
      "SECOP solicita un CAPTCHA o una comprobación de acceso. Abre el documento, completa la comprobación y reintenta. Si continúa bloqueado, descarga el archivo allí y adjúntalo aquí.",
    retryDownload: "Reintentar descarga automática",
    remoteRunning: "Descargando documento y analizando…",
    downloadFailed:
      "No se pudo descargar el documento. Reintenta o consulta el documento original en SECOP.",
    file: "Documento descargado: PDF, DOCX o XLSX (máximo 5 MB)",
    run: "Guardar interés y analizar documento",
    running: "Guardando archivo y analizando…",
    history: "Análisis guardados",
    historyError: "No se pudieron cargar los análisis guardados.",
    analysisError:
      "No se pudo completar el análisis. El archivo podría haberse guardado; revisa la conexión e inténtalo de nuevo.",
    saveError:
      "El análisis terminó, pero no se pudo guardar el resultado. Conserva esta vista y vuelve a intentar guardar.",
    save: "Guardar resultado",
    invalid: "Selecciona un archivo válido (PDF, DOCX o XLSX) de hasta 5 MB.",
    aiHint:
      "La IA puede cometer errores. Verifica los requisitos en el documento original; una referencia ausente no confirma que el requisito no exista.",
    source: "Abrir expediente en SECOP",
    selected: "Documento elegido",
    cancel: "Cancelar",
    savedFile: "Descargar documento guardado",
    notConfigured:
      "La IA no está configurada para este espacio. Configúrala en Savia y vuelve a intentar.",
    specification: "Pliego / invitación",
    annex: "Anexo",
    amendment: "Adenda",
    other: "Documento",
    noHistory:
      "Los análisis que guardes aparecerán aquí, también después de recargar.",
    historyLoading: "Cargando análisis guardados…",
  },
  en: {
    back: "Back to tenders",
    overview: "Overview",
    documents: "Documents",
    load: "Loading tender documents…",
    empty:
      "No documents are linked to this portfolio in the public catalog. Open SECOP or analyze a downloaded document (PDF, DOCX or XLSX).",
    error: "Documents could not be loaded. Retry or open the SECOP portfolio.",
    retry: "Retry",
    more: "Load more documents",
    download: "Download on SECOP",
    analyze: "Analyze document",
    upload: "Analyze a downloaded document",
    hint: "Analyzing the document downloads the official file and saves its analysis automatically. Only the file content (PDF, DOCX or XLSX) is analyzed, never the link or filename.",
    challenge:
      "SECOP requires a CAPTCHA or access check. Open the document, complete the check, and retry. If it remains blocked, download the file there and attach it here.",
    retryDownload: "Retry automatic download",
    remoteRunning: "Downloading document and analyzing…",
    downloadFailed:
      "The document could not be downloaded. Retry or open the original document on SECOP.",
    file: "Downloaded document: PDF, DOCX or XLSX (up to 5 MB)",
    run: "Save interest and analyze document",
    running: "Saving file and analyzing…",
    history: "Saved analyses",
    historyError: "Saved analyses could not be loaded.",
    analysisError:
      "Analysis failed. The file may have been saved; check your connection and retry.",
    saveError:
      "Analysis finished, but its result could not be saved. Keep this view open and retry saving.",
    save: "Save result",
    invalid: "Select a valid file (PDF, DOCX or XLSX) up to 5 MB.",
    aiHint:
      "AI can make mistakes. Verify requirements in the original document; missing references do not confirm that a requirement is absent.",
    source: "Open SECOP portfolio",
    selected: "Selected document",
    cancel: "Cancel",
    savedFile: "Download saved document",
    notConfigured:
      "AI is not configured for this workspace. Configure it in Savia and retry.",
    specification: "Specification / invitation",
    annex: "Annex",
    amendment: "Amendment",
    other: "Document",
    noHistory: "Saved analyses will appear here, including after reloading.",
    historyLoading: "Loading saved analyses…",
  },
  pt: {
    back: "Voltar às licitações",
    overview: "Resumo",
    documents: "Documentos",
    load: "Carregando documentos do processo…",
    empty:
      "Não há documentos vinculados a este expediente no catálogo público. Consulte o SECOP ou analise um documento baixado (PDF, DOCX ou XLSX).",
    error:
      "Não foi possível carregar os documentos. Tente novamente ou abra o SECOP.",
    retry: "Tentar novamente",
    more: "Carregar mais documentos",
    download: "Baixar no SECOP",
    analyze: "Analisar documento",
    upload: "Analisar um documento baixado",
    hint: "Analisar o documento baixa o arquivo oficial e salva a análise automaticamente. Apenas o conteúdo do arquivo (PDF, DOCX ou XLSX) é analisado, nunca o link ou o nome.",
    challenge:
      "O SECOP exige CAPTCHA ou verificação de acesso. Abra o documento, conclua a verificação e tente novamente. Se continuar bloqueado, baixe o arquivo e anexe-o aqui.",
    retryDownload: "Tentar download automático novamente",
    remoteRunning: "Baixando documento e analisando…",
    downloadFailed:
      "Não foi possível baixar o documento. Tente novamente ou abra o documento original no SECOP.",
    file: "Documento baixado: PDF, DOCX ou XLSX (até 5 MB)",
    run: "Salvar interesse e analisar documento",
    running: "Salvando arquivo e analisando…",
    history: "Análises salvas",
    historyError: "Não foi possível carregar as análises salvas.",
    analysisError:
      "A análise falhou. O arquivo pode ter sido salvo; verifique a conexão e tente novamente.",
    saveError:
      "A análise terminou, mas o resultado não foi salvo. Mantenha esta tela aberta e tente salvar novamente.",
    save: "Salvar resultado",
    invalid: "Selecione um arquivo válido (PDF, DOCX ou XLSX) de até 5 MB.",
    aiHint:
      "A IA pode cometer erros. Confira os requisitos no documento original; uma referência ausente não confirma a ausência do requisito.",
    source: "Abrir expediente no SECOP",
    selected: "Documento selecionado",
    cancel: "Cancelar",
    savedFile: "Baixar documento salvo",
    notConfigured:
      "A IA não está configurada neste espaço. Configure-a no Savia e tente novamente.",
    specification: "Edital / convite",
    annex: "Anexo",
    amendment: "Adenda",
    other: "Documento",
    noHistory: "As análises salvas aparecerão aqui, inclusive após recarregar.",
    historyLoading: "Carregando análises salvas…",
  },
};
function analysisFilename(name: string) {
  return name.length > 200 ? name.slice(0, 196) + name.slice(-4) : name;
}
type SavedAnalysis = Record<string, unknown> & {
  id: string;
  name: string;
  analysis: string;
  model: string;
  analyzed_at: string;
  file_url?: string;
};
export function TenderDocuments({
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
  const t = copy[locale];
  const processId = String(row.process_id ?? "");
  const [tab, setTab] = useState("documents");
  const [documents, setDocuments] = useState<TenderDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [selected, setSelected] = useState<TenderDocument | null | undefined>(
    undefined,
  );
  const [manualUpload, setManualUpload] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [reports, setReports] = useState<SavedAnalysis[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [unsaved, setUnsaved] = useState<Record<string, unknown> | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (analysisError) feedback.current?.focus();
  }, [analysisError]);
  const alive = useRef(true);
  const currentRequest = useRef(0);
  const lock = useRef(false);
  const retryFile = useRef<{ fileId: string; recordId: string } | null>(null);
  const reportsCollection =
    savia.collections.collection<SavedAnalysis>(DOCUMENTS_COLLECTION);
  async function load(next = 1) {
    if (lock.current) return;
    lock.current = true;
    setLoading(true);
    setError(false);
    const request = ++currentRequest.current;
    try {
      const result = await loadTenderDocuments(savia, processId, next);
      if (!alive.current || request !== currentRequest.current) return;
      setDocuments((old) => [
        ...new Map(
          [...(next === 1 ? [] : old), ...result.data].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ]);
      setPage(next);
      setHasNext(result.hasNext);
    } catch {
      if (alive.current) setError(true);
    } finally {
      lock.current = false;
      if (alive.current) setLoading(false);
    }
  }
  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const result = await reportsCollection.list({
        page: 1,
        perPage: 50,
        filters: {
          conditions: [{ field: "process_id", op: "eq", value: processId }],
        },
      });
      if (alive.current) setReports(result.data);
    } catch {
      if (alive.current) setHistoryError(true);
    } finally {
      if (alive.current) setHistoryLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    void loadHistory();
    return () => {
      alive.current = false;
      currentRequest.current++;
    };
  }, [processId, savia]);
  async function persist(values: Record<string, unknown>) {
    try {
      const record = await reportsCollection.create(values);
      if (alive.current) {
        setReports((old) => [record, ...old]);
        setUnsaved(null);
      }
    } catch {
      if (alive.current) setUnsaved(values);
    }
  }
  async function analyze(remote?: TenderDocument) {
    if ((!file && !remote) || busy) return;
    const document = remote ?? selected;
    if (remote) {
      setSelected(remote);
      setManualUpload(false);
      setFile(null);
    }
    setRemoteBusy(Boolean(remote));
    setBusy(true);
    setAnalysisError("");
    let targetRecordId: string | undefined;
    try {
      let data: string | undefined;
      try {
        if (!remote) data = await documentBase64(file!);
      } catch {
        setAnalysisError(t.invalid);
        return;
      }
      const normalized = normalizeSecopRow({
        ...row,
        id: String(row.source_id ?? row.id),
      });
      if (!normalized) throw new Error("Missing tender identity");
      const interest = await saveInterest(savia, normalized);
      targetRecordId = interest.record.id;
      const result: DocumentAnalysis = await analyzeTenderPdf({
        recordId: interest.record.id,
        ...(retryFile.current?.recordId === interest.record.id
          ? { fileId: retryFile.current.fileId }
          : remote
            ? {
                filename: analysisFilename(remote.name),
                downloadUrl: remote.url,
              }
            : { filename: analysisFilename(file!.name), data: data! }),
        locale,
        ...(document ? { sourceUrl: document.url } : {}),
      });
      const downloadUrl = (result.file as { downloadUrl?: string }).downloadUrl;
      const values = {
        name: remote?.name ?? file!.name,
        process_id: processId,
        interest_id: interest.record.id,
        document_id: document?.id ?? "",
        source_url: document?.url ?? "",
        file_id: result.file.id,
        file_url: downloadUrl ?? "",
        analysis: result.analysis,
        model: result.model,
        analyzed_at: result.analyzedAt,
      };
      if (alive.current) {
        retryFile.current = null;
        await persist(values);
        setSelected(undefined);
        setFile(null);
      }
    } catch (error) {
      const failed = error as { code?: string; fileId?: string };
      if (failed.fileId && targetRecordId)
        retryFile.current = { fileId: failed.fileId, recordId: targetRecordId };
      if (alive.current) {
        if (failed.code === "DOCUMENT_ACCESS_CHALLENGE") setManualUpload(true);
        setAnalysisError(
          failed.code === "DOCUMENT_ACCESS_CHALLENGE"
            ? t.challenge
            : failed.code === "DOCUMENT_TOO_LARGE" ||
                failed.code === "INVALID_DOCUMENT" ||
                failed.code === "UNSUPPORTED_DOCUMENT_TYPE"
              ? t.invalid
              : failed.code === "DOCUMENT_DOWNLOAD_FAILED"
                ? t.downloadFailed
                : (error as { code?: string })?.code?.includes(
                      "NOT_CONFIGURED",
                    ) ||
                    (error as { code?: string }).code === "ANALYSIS_UNAVAILABLE"
                  ? t.notConfigured
                  : t.analysisError,
        );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const source =
    typeof row.source_url === "string" && row.source_url.startsWith("https://")
      ? row.source_url
      : null;
  return (
    <main className="secop-app secop-document-page">
      <button
        type="button"
        className="secop-icon-action"
        aria-label={t.back}
        title={t.back}
        onClick={onBack}
        disabled={busy || !!unsaved}
      >
        <ArrowLeft size={16} aria-hidden="true" />
      </button>
      <header className="secop-header">
        <div>
          <h1>{String(row.name ?? processId)}</h1>
          <p>
            {processId} · {String(row.entity ?? "")}
          </p>
        </div>
      </header>
      <div
        className="secop-tabs"
        role="tablist"
        aria-label={String(row.name ?? processId)}
      >
        {(["overview", "documents"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`secop-${value}-tab`}
            aria-controls={`secop-${value}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const next = value === "overview" ? "documents" : "overview";
                setTab(next);
                document.getElementById(`secop-${next}-tab`)?.focus();
              }
            }}
            onClick={() => setTab(value)}
          >
            {t[value]}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <section
          role="tabpanel"
          id="secop-overview-panel"
          aria-labelledby="secop-overview-tab"
        >
          <h2>{t.overview}</h2>
          <p>{String(row.name ?? "")}</p>
          <p>
            {String(row.entity ?? "")} · {String(row.source_status ?? "")}
          </p>
          {source && (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="secop-icon-action"
              aria-label={t.source}
              title={t.source}
            >
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          )}
        </section>
      ) : (
        <section
          role="tabpanel"
          id="secop-documents-panel"
          aria-labelledby="secop-documents-tab"
        >
          <div className="secop-section-head">
            <h2>{t.documents}</h2>
            {source && (
              <a
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="secop-icon-action"
                aria-label={t.source}
                title={t.source}
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            )}
          </div>
          <p className="secop-document-hint">{t.hint}</p>
          {loading && (
            <div className="secop-loading-card" role="status">
              <div className="secop-loading-spinner" aria-hidden="true" />
              <div className="secop-loading-card-body">
                <p>{t.load}</p>
                <div className="secop-skeleton-lines" aria-hidden="true">
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="secop-error" role="alert">
              <p>{t.error}</p>
              <button
                type="button"
                className="secop-primary"
                onClick={() => void load(page ? page + 1 : 1)}
              >
                {t.retry}
              </button>
            </div>
          )}
          {!loading && !error && !documents.length && (
            <div className="secop-empty" role="status">
              <p>{t.empty}</p>
            </div>
          )}
          <ul className="secop-document-list">
            {documents.map((item) => (
              <li key={item.id} className="secop-document-item">
                <div className="secop-document-info">
                  <h3>{item.name}</h3>
                  <p className="secop-document-meta">
                    <span className="secop-status">{t[item.kind]}</span>
                    {(item.date || item.size) && (
                      <span className="secop-document-facts">
                        {item.date ? `${item.date.slice(0, 10)}` : ""}
                        {item.date && item.size ? " · " : ""}
                        {item.size ? `${(item.size / 1024).toFixed(0)} KB` : ""}
                      </span>
                    )}
                  </p>
                </div>
                <div className="secop-document-actions">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="secop-icon-action"
                    aria-label={t.download}
                    title={t.download}
                  >
                    <Download size={16} aria-hidden="true" />
                  </a>
                  {isSupportedDocumentName(item.name) && (
                    <button
                      type="button"
                      disabled={busy || !!unsaved}
                      onClick={() => {
                        retryFile.current = null;
                        void analyze(item);
                      }}
                    >
                      {busy && selected?.id === item.id
                        ? t.remoteRunning
                        : t.analyze}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hasNext && !error && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(page + 1)}
            >
              {t.more}
            </button>
          )}
          {selected === undefined || !manualUpload ? (
            <button
              type="button"
              className="secop-upload-toggle"
              disabled={busy || !!unsaved}
              onClick={() => {
                retryFile.current = null;
                setSelected(null);
                setManualUpload(true);
                setFile(null);
                setAnalysisError("");
              }}
            >
              {t.upload}
            </button>
          ) : (
            <form
              className="secop-analysis-form"
              onSubmit={(event) => {
                event.preventDefault();
                void analyze();
              }}
            >
              <h3>{t.upload}</h3>
              {selected && (
                <p className="secop-selected-document">
                  {t.selected}: <strong>{selected.name}</strong>
                </p>
              )}
              <label>
                {t.file}
                <input
                  type="file"
                  accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx"
                  disabled={busy}
                  onChange={(event) => {
                    retryFile.current = null;
                    setFile(event.target.files?.[0] ?? null);
                  }}
                />
              </label>
              <p className="secop-document-hint">{t.aiHint}</p>
              <div className="secop-document-actions">
                <button
                  type="button"
                  onClick={() => void analyze()}
                  className="secop-primary"
                  disabled={!file || busy}
                >
                  {busy ? t.running : t.run}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(undefined);
                    setFile(null);
                  }}
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          )}
          {busy && (
            <div role="status" className="secop-loading-card">
              <div className="secop-loading-spinner" aria-hidden="true" />
              <div className="secop-loading-card-body">
                <p>{remoteBusy ? t.remoteRunning : t.running}</p>
                <div className="secop-skeleton-lines" aria-hidden="true">
                  <span />
                </div>
              </div>
            </div>
          )}
          {analysisError && (
            <div
              ref={feedback}
              tabIndex={-1}
              role="alert"
              className="secop-error"
            >
              <p>{analysisError}</p>
              {selected && (
                <div className="secop-document-actions">
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.download}
                  </a>
                  <button
                    type="button"
                    className="secop-primary"
                    disabled={busy}
                    onClick={() => void analyze(selected)}
                  >
                    {t.retryDownload}
                  </button>
                </div>
              )}
            </div>
          )}
          {unsaved && (
            <div role="alert" className="secop-error">
              <p>{t.saveError}</p>
              <pre className="secop-analysis-text">
                {String(unsaved.analysis)}
              </pre>
              <button
                type="button"
                className="secop-primary"
                onClick={() => void persist(unsaved)}
              >
                {t.save}
              </button>
            </div>
          )}
          <section className="secop-analysis-history" aria-label={t.history}>
            <h2>{t.history}</h2>
            {historyLoading && (
              <div role="status" className="secop-loading-card">
                <div className="secop-loading-spinner" aria-hidden="true" />
                <div className="secop-loading-card-body">
                  <p>{t.historyLoading}</p>
                  <div className="secop-skeleton-lines" aria-hidden="true">
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
            {historyError && (
              <div role="alert" className="secop-error">
                <p>{t.historyError}</p>
                <button
                  type="button"
                  className="secop-primary"
                  onClick={() => void loadHistory()}
                >
                  {t.retry}
                </button>
              </div>
            )}
            {!historyLoading && !historyError && !reports.length && (
              <div className="secop-empty" role="status">
                <p>{t.noHistory}</p>
              </div>
            )}
            {reports.map((report) => (
              <details key={report.id} className="secop-analysis-report" open>
                <summary>
                  {report.name} ·{" "}
                  {new Date(report.analyzed_at).toLocaleString(
                    locale === "en"
                      ? "en-US"
                      : locale === "pt"
                        ? "pt-BR"
                        : "es-CO",
                    { timeZone: "America/Bogota" },
                  )}
                </summary>
                <p className="secop-document-hint">
                  {report.model} · {t.aiHint}
                </p>
                {safeStoredFileUrl(report.file_url, window.location.origin) && (
                  <a
                    href={
                      safeStoredFileUrl(
                        report.file_url,
                        window.location.origin,
                      ) ?? undefined
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.savedFile}
                  </a>
                )}
                <pre className="secop-analysis-text">{report.analysis}</pre>
              </details>
            ))}
          </section>
        </section>
      )}
    </main>
  );
}
