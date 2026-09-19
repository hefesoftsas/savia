import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  csv,
  errorMessage,
  loadRecords,
  text,
  today,
  type WorkRecord,
} from "./data";
import { RecordEditor } from "./editor";
import type { WorkbenchConfig } from "./types";
import "./workbench.css";

// THESIS: an actionable work queue, with context retained while editing.
// OWN-WORLD: Savia theme tokens, compact controls, tabular figures and quiet rules.
// STORY: identify priority, inspect an account or case, save the next action.
// FIRST VIEWPORT: title/action, operational totals, priority filters, table/editor.
// FORM: existing administrative worklist extended with a responsive inline panel.
export function Workbench({
  savia,
  config,
}: {
  savia: PluginApi;
  config: WorkbenchConfig;
}) {
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ record: WorkRecord | null } | null>(
    null,
  );
  const [asOf, setAsOf] = useState(today);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setRecords([]);
    setAsOf(today());
    loadRecords(savia, config.object)
      .then((result) => {
        if (active) setRecords(result);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [savia, config.object, revision]);
  const filtered = useMemo(() => {
    const normalize = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es");
    const needle = normalize(query.trim());
    return records.filter(
      (record) =>
        config.matches(record, filter, asOf) &&
        (!stage || record.stage === stage) &&
        (!needle ||
          [
            record.name,
            record.customer,
            record.policy_reference,
            record.insurer,
            record.owner,
          ].some((value) => normalize(text(value)).includes(needle))),
    );
  }, [records, query, filter, stage, asOf, config]);
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const metrics = config.metrics(records, asOf);
  function close() {
    setEditor(null);
    requestAnimationFrame(() => opener.current?.focus());
  }
  function exportCsv() {
    const blob = new Blob(
      [csv([config.exportHeaders, ...filtered.map(config.exportRow)])],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `${config.object}-${asOf}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="iw-workbench" aria-label={config.title}>
      <header className="iw-heading">
        <div>
          <p className="iw-context">Seguros / Operación diaria</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <button
          className="iw-primary"
          disabled={loading || !!error || !!editor}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setNotice("");
            setEditor({ record: null });
          }}
        >
          {config.createLabel}
        </button>
      </header>
      <div className="iw-announcements" aria-live="polite">
        {notice && <p className="iw-notice">{notice}</p>}
      </div>
      {error && (
        <div className="iw-error" role="alert">
          <strong>No se pudo cargar la lista.</strong>
          <p>{error}</p>
          <button onClick={() => setRevision((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}
      <dl
        className="iw-metrics"
        aria-label="Resumen de la colección"
        aria-busy={loading}
      >
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{loading || error ? "—" : metric.value}</dd>
            <small>{metric.detail}</small>
          </div>
        ))}
      </dl>
      <div className={`iw-layout${editor ? " iw-with-editor" : ""}`}>
        <div className="iw-list">
          <nav className="iw-filters" aria-label="Prioridad">
            {config.filters.map((item) => (
              <button
                key={item.value}
                aria-pressed={filter === item.value}
                onClick={() => {
                  setFilter(item.value);
                  setPage(1);
                }}
              >
                {item.label}
                <span>
                  {loading || error
                    ? "—"
                    : records.filter((record) =>
                        config.matches(record, item.value, asOf),
                      ).length}
                </span>
              </button>
            ))}
          </nav>
          <div className="iw-toolbar">
            <label className="iw-search">
              <span className="iw-sr-only">Buscar registros</span>
              <input
                type="search"
                placeholder="Buscar cliente, póliza o responsable…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              <span className="iw-sr-only">Filtrar por etapa</span>
              <select
                value={stage}
                onChange={(event) => {
                  setStage(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todas las etapas</option>
                {config.stages.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Actualizar lista"
              disabled={loading || !!editor}
              onClick={() => setRevision((value) => value + 1)}
            >
              Actualizar
            </button>
            <button
              disabled={loading || !!error || !filtered.length}
              onClick={exportCsv}
            >
              Exportar CSV
            </button>
          </div>
          {loading ? (
            <div className="iw-loading" role="status">
              <p>Cargando registros…</p>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} />
              ))}
            </div>
          ) : (
            !error && (
              <>
                {!filtered.length ? (
                  <div className="iw-empty">
                    <h2>
                      {records.length
                        ? "No hay coincidencias"
                        : `Tu gestión de ${config.title.toLowerCase()} empieza aquí`}
                    </h2>
                    <p>
                      {records.length
                        ? "Prueba otra búsqueda o elimina los filtros para ver más registros."
                        : "Crea el primer registro para organizar vencimientos, responsables y próximas acciones."}
                    </p>
                    {records.length > 0 && (
                      <button
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                          setStage("");
                          setPage(1);
                        }}
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    className="iw-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Lista de registros"
                  >
                    <table>
                      <caption className="iw-sr-only">
                        {config.title}: {filtered.length} registros encontrados
                      </caption>
                      <thead>
                        <tr>
                          {config.columns.map((column) => (
                            <th
                              key={column.key}
                              scope="col"
                              className={
                                column.numeric ? "iw-numeric" : undefined
                              }
                            >
                              {column.label}
                            </th>
                          ))}
                          <th scope="col">
                            <span className="iw-sr-only">Acciones</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((record) => (
                          <tr
                            key={record.id}
                            data-selected={editor?.record?.id === record.id}
                          >
                            {config.columns.map((column) => (
                              <td
                                key={column.key}
                                data-label={column.label}
                                className={
                                  column.numeric ? "iw-numeric" : undefined
                                }
                              >
                                {column.render(record, asOf)}
                              </td>
                            ))}
                            <td>
                              <button
                                aria-label={`Gestionar ${text(record.name)}`}
                                disabled={!!editor}
                                onClick={(event) => {
                                  opener.current = event.currentTarget;
                                  setNotice("");
                                  setEditor({ record });
                                }}
                              >
                                Gestionar <span aria-hidden="true">↗</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <footer className="iw-pagination">
                  <span>
                    {filtered.length}{" "}
                    {filtered.length === 1 ? "registro" : "registros"} ·{" "}
                    {config.footerNote ?? "Valores en COP"}
                  </span>
                  <div>
                    <button
                      aria-label="Página anterior"
                      disabled={currentPage <= 1}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Anterior
                    </button>
                    <span>
                      {currentPage} / {pages}
                    </span>
                    <button
                      aria-label="Página siguiente"
                      disabled={currentPage >= pages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Siguiente
                    </button>
                  </div>
                </footer>
              </>
            )
          )}
        </div>
        {editor && (
          <RecordEditor
            key={editor.record?.id ?? "new"}
            config={config}
            savia={savia}
            record={editor.record}
            onClose={close}
            onSaved={() => {
              close();
              setNotice("Cambios guardados.");
              setRevision((value) => value + 1);
            }}
          />
        )}
      </div>
    </section>
  );
}
