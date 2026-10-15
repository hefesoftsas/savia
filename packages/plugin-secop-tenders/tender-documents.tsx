import { useEffect, useRef, useState } from "react";
import type { PluginApi } from "@savia/plugin-sdk";
import { normalizeSecopRow, saveInterest, type SecopRow } from "./logic";
import {
  analyzeTenderPdf,
  safeStoredFileUrl,
  DOCUMENTS_COLLECTION,
  loadTenderDocuments,
  pdfBase64,
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
      "No hay documentos vinculados a este expediente en el catálogo público. Puedes consultar SECOP y analizar un PDF descargado.",
    error:
      "No se pudieron cargar los documentos. Reintenta o consulta el expediente en SECOP.",
    retry: "Reintentar",
    more: "Cargar más documentos",
    download: "Descargar en SECOP",
    analyze: "Analizar este PDF",
    upload: "Analizar un PDF descargado",
    hint: "Analizar este PDF descarga el archivo oficial y guarda el análisis automáticamente. Solo se analiza el contenido del PDF, nunca el enlace ni su nombre.",
    challenge:
      "SECOP solicita un CAPTCHA o una comprobación de acceso. Abre el documento, completa la comprobación y reintenta. Si continúa bloqueado, descarga el PDF allí y adjúntalo aquí.",
    retryDownload: "Reintentar descarga automática",
    remoteRunning: "Descargando PDF y analizando…",
    downloadFailed:
      "No se pudo descargar el PDF. Reintenta o consulta el documento original en SECOP.",
    file: "PDF descargado (máximo 5 MB)",
    run: "Guardar interés y analizar PDF",
    running: "Guardando archivo y analizando…",
    history: "Análisis guardados",
    historyError: "No se pudieron cargar los análisis guardados.",
    analysisError:
      "No se pudo completar el análisis. El archivo podría haberse guardado; revisa la conexión e inténtalo de nuevo.",
    saveError:
      "El análisis terminó, pero no se pudo guardar el resultado. Conserva esta vista y vuelve a intentar guardar.",
    save: "Guardar resultado",
    invalid: "Selecciona un archivo PDF válido de hasta 5 MB.",
    aiHint:
      "La IA puede cometer errores. Verifica los requisitos en el documento original; una referencia ausente no confirma que el requisito no exista.",
    source: "Abrir expediente en SECOP",
    selected: "Documento elegido",
    cancel: "Cancelar",
    savedFile: "Descargar PDF guardado",
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
      "No documents are linked to this portfolio in the public catalog. Open SECOP or analyze a downloaded PDF.",
    error: "Documents could not be loaded. Retry or open the SECOP portfolio.",
    retry: "Retry",
    more: "Load more documents",
    download: "Download on SECOP",
    analyze: "Analyze this PDF",
    upload: "Analyze a downloaded PDF",
    hint: "Analyze this PDF downloads the official file and saves its analysis automatically. Only the PDF content is analyzed, never the link or filename.",
    challenge:
      "SECOP requires a CAPTCHA or access check. Open the document, complete the check, and retry. If it remains blocked, download the PDF there and attach it here.",
    retryDownload: "Retry automatic download",
    remoteRunning: "Downloading PDF and analyzing…",
    downloadFailed:
      "The PDF could not be downloaded. Retry or open the original document on SECOP.",
    file: "Downloaded PDF (up to 5 MB)",
    run: "Save interest and analyze PDF",
    running: "Saving file and analyzing…",
    history: "Saved analyses",
    historyError: "Saved analyses could not be loaded.",
    analysisError:
      "Analysis failed. The file may have been saved; check your connection and retry.",
    saveError:
      "Analysis finished, but its result could not be saved. Keep this view open and retry saving.",
    save: "Save result",
    invalid: "Select a valid PDF up to 5 MB.",
    aiHint:
      "AI can make mistakes. Verify requirements in the original document; missing references do not confirm that a requirement is absent.",
    source: "Open SECOP portfolio",
    selected: "Selected document",
    cancel: "Cancel",
    savedFile: "Download saved PDF",
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
      "Não há documentos vinculados a este expediente no catálogo público. Consulte o SECOP ou analise um PDF baixado.",
    error:
      "Não foi possível carregar os documentos. Tente novamente ou abra o SECOP.",
    retry: "Tentar novamente",
    more: "Carregar mais documentos",
    download: "Baixar no SECOP",
    analyze: "Analisar este PDF",
    upload: "Analisar um PDF baixado",
    hint: "Analisar este PDF baixa o arquivo oficial e salva a análise automaticamente. Apenas o conteúdo do PDF é analisado, nunca o link ou o nome.",
    challenge:
      "O SECOP exige CAPTCHA ou verificação de acesso. Abra o documento, conclua a verificação e tente novamente. Se continuar bloqueado, baixe o PDF e anexe-o aqui.",
    retryDownload: "Tentar download automático novamente",
    remoteRunning: "Baixando PDF e analisando…",
    downloadFailed:
      "Não foi possível baixar o PDF. Tente novamente ou abra o documento original no SECOP.",
    file: "PDF baixado (até 5 MB)",
    run: "Salvar interesse e analisar PDF",
    running: "Salvando arquivo e analisando…",
    history: "Análises salvas",
    historyError: "Não foi possível carregar as análises salvas.",
    analysisError:
      "A análise falhou. O arquivo pode ter sido salvo; verifique a conexão e tente novamente.",
    saveError:
      "A análise terminou, mas o resultado não foi salvo. Mantenha esta tela aberta e tente salvar novamente.",
    save: "Salvar resultado",
    invalid: "Selecione um PDF válido de até 5 MB.",
    aiHint:
      "A IA pode cometer erros. Confira os requisitos no documento original; uma referência ausente não confirma a ausência do requisito.",
    source: "Abrir expediente no SECOP",
    selected: "Documento selecionado",
    cancel: "Cancelar",
    savedFile: "Baixar PDF salvo",
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
        if (!remote) data = await pdfBase64(file!);
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
      <button type="button" onClick={onBack} disabled={busy || !!unsaved}>
        {t.back}
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
            <a href={source} target="_blank" rel="noopener noreferrer">
              {t.source}
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
              <a href={source} target="_blank" rel="noopener noreferrer">
                {t.source}
              </a>
            )}
          </div>
          <p className="secop-document-hint">{t.hint}</p>
          {loading && (
            <p className="secop-loading" role="status">
              {t.load}
            </p>
          )}
          {error && (
            <p className="secop-error" role="alert">
              {t.error}{" "}
              <button
                type="button"
                onClick={() => void load(page ? page + 1 : 1)}
              >
                {t.retry}
              </button>
            </p>
          )}
          {!loading && !error && !documents.length && (
            <p className="secop-state">{t.empty}</p>
          )}
          <ul className="secop-document-list">
            {documents.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {t[item.kind]}
                    {item.date ? ` · ${item.date.slice(0, 10)}` : ""}
                    {item.size ? ` · ${(item.size / 1024).toFixed(0)} KB` : ""}
                  </p>
                </div>
                <div className="secop-document-actions">
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    {t.download}
                  </a>
                  {/\.pdf$/i.test(item.name) && (
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
                <p>
                  {t.selected}: <strong>{selected.name}</strong>
                </p>
              )}
              <label>
                {t.file}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
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
            <p role="status" className="secop-loading">
              {remoteBusy ? t.remoteRunning : t.running}
            </p>
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
              <button type="button" onClick={() => void persist(unsaved)}>
                {t.save}
              </button>
            </div>
          )}
          <section className="secop-analysis-history" aria-label={t.history}>
            <h2>{t.history}</h2>
            {historyLoading && (
              <p role="status" className="secop-loading">
                {t.historyLoading}
              </p>
            )}
            {historyError && (
              <p role="alert" className="secop-error">
                {t.historyError}{" "}
                <button type="button" onClick={() => void loadHistory()}>
                  {t.retry}
                </button>
              </p>
            )}
            {!historyLoading && !historyError && !reports.length && (
              <p className="secop-document-hint">{t.noHistory}</p>
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
