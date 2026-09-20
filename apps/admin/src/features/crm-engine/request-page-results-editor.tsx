import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { RESULT_REACT_EXAMPLE } from "./result-react-example";
import { resultHtmlExample } from "./result-html-example";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MonacoCodeEditor } from "./monaco-code-editor";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResultCards } from "./result-cards";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_RESULT_COLUMNS,
  RESULT_COLUMN_FORMAT_LABELS,
  RESULT_COLUMN_PRESETS,
  isValidResultColumnPointer,
  reorderResultColumns,
  resolveRequestActionLabel,
  type RequestPageConfig,
  type ResultColumn,
  type ResultColumnFormat,
} from "@savia/crm-shared/request-page";
import {
  LocalizedFieldLabelEditor,
  useFieldLabelLocale,
} from "./localized-field-label-editor";
import { StudioControlLabel } from "./studio-control-label";
import "./request-page-results-editor.css";

const dragType = "application/x-savia-result-column";
const SAMPLE_OFFER = {
  provider: "SBS",
  reference: "SIM-0001",
  product: { id: "gold", name: "SBS · Gold" },
  premium: { total: 1250000, net: 1050000, tax: 200000, currency: "COP" },
};

const submitLabelHelp =
  "Texto del botón que ejecuta las operaciones seleccionadas en el formulario.";
const resultColumnsHelp =
  "Elige los datos que aparecen en la tabla, las tarjetas y el comparador.";
const submitActionsHelp =
  "Etiquetas visibles cuando el usuario elige qué operaciones ejecutar.";

function jsonPointer(value: Record<string, unknown>, pointer: string): unknown {
  return pointer
    .slice(1)
    .split("/")
    .reduce<unknown>(
      (current, segment) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      value,
    );
}

function presetValue(column: ResultColumn) {
  if (RESULT_COLUMN_PRESETS.some((entry) => entry.pointer === column.pointer)) {
    return column.pointer;
  }
  return "__custom__";
}

export function RequestPageResultsEditor({
  config,
  onChange,
}: {
  config: RequestPageConfig;
  onChange: (config: RequestPageConfig) => void;
}) {
  const t = useMessages(automationMessages);
  const locale = useAppLocale();
  function nextPresetColumn(columns: ResultColumn[]): ResultColumn {
    const used = new Set(columns.map((column) => column.pointer));
    const available = RESULT_COLUMN_PRESETS.find(
      (preset) => !used.has(preset.pointer),
    );
    if (available)
      return {
        ...available,
        label: t(available.label as keyof typeof automationMessages),
      };
    return {
      label: t("Columna %{value0}", { value0: columns.length + 1 }),
      pointer: "/reference",
      format: "text",
    };
  }

  function formatPreviewValue(
    value: unknown,
    format: ResultColumnFormat,
    currency?: string | null,
  ) {
    if (value === null || value === undefined || value === "") {
      return t("No informado");
    }
    if (format === "money" && Number.isFinite(Number(value))) {
      try {
        return new Intl.NumberFormat(intlLocale(locale), {
          style: "currency",
          currency: currency ?? "COP",
        }).format(Number(value));
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  const labelLocale = useFieldLabelLocale();
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState("");
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const submitActions = useMemo(
    () => config.actions.filter((action) => action.kind === "submit"),
    [config.actions],
  );

  const updateColumn = (index: number, patch: Partial<ResultColumn>) => {
    onChange({
      ...config,
      resultColumns: config.resultColumns.map((column, currentIndex) =>
        currentIndex === index ? { ...column, ...patch } : column,
      ),
    });
  };

  const removeColumn = (index: number) => {
    onChange({
      ...config,
      resultColumns: config.resultColumns.filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    });
  };

  const moveColumn = (sourceIndex: number, targetIndex: number) => {
    onChange({
      ...config,
      resultColumns: reorderResultColumns(
        config.resultColumns,
        sourceIndex,
        targetIndex,
      ),
    });
  };

  return (
    <Tabs defaultValue="configure" className="request-page-results-editor">
      <TabsList aria-label={t("Editor de resultados")}>
        <TabsTrigger value="configure">{t("Configurar")}</TabsTrigger>
        <TabsTrigger value="preview">{t("Vista previa")}</TabsTrigger>
      </TabsList>
      <TabsContent value="configure" className="request-results-configure">
        <details className="request-results-group" open>
          <summary>{t("Presentación")}</summary>
          <label className="studio-control">
            <StudioControlLabel
              label={t("Presentación de resultados")}
              help={t(
                "Se guarda para esta pantalla. Las tarjetas y el comparador utilizan los campos configurados abajo.",
              )}
            />
            <select
              aria-label={t("Presentación de resultados")}
              value={config.resultLayout ?? "table"}
              onChange={(event) =>
                onChange({
                  ...config,
                  resultLayout: event.target
                    .value as RequestPageConfig["resultLayout"],
                })
              }
            >
              <option value="table">{t("Tabla e historial")}</option>
              <option value="cards">{t("Tarjetas")}</option>
              <option value="comparison">{t("Tarjetas y comparación")}</option>
              <option value="html">{t("HTML personalizado")}</option>
              <option value="react">{t("React personalizado")}</option>
            </select>
          </label>
        </details>
        <details className="request-results-execution-settings request-results-group">
          <summary>{t("Botón y nombres de operaciones")}</summary>
          <section className="request-page-results-section">
            <label className="studio-control">
              <StudioControlLabel
                label={t("Texto del botón principal")}
                help={t(submitLabelHelp)}
              />
              <Input
                aria-label={t("Texto del botón principal")}
                value={config.submitLabel}
                maxLength={80}
                onChange={(event) =>
                  onChange({ ...config, submitLabel: event.target.value })
                }
              />
            </label>
          </section>

          {submitActions.length > 0 ? (
            <section className="request-page-results-section">
              <div className="request-page-results-section-heading">
                <h4>{t("Operaciones")}</h4>
                <p className="studio-field-help">{t(submitActionsHelp)}</p>
              </div>
              <ol
                className="request-results-action-list"
                aria-label={t("Operaciones")}
              >
                {submitActions.map((action) => (
                  <li key={action.id} className="request-results-action-item">
                    <p className="request-results-action-id">{action.id}</p>
                    <LocalizedFieldLabelEditor
                      field={action}
                      onChange={({ label, labels }) =>
                        onChange({
                          ...config,
                          actions: config.actions.map((entry) =>
                            entry.id === action.id
                              ? { ...entry, label, labels }
                              : entry,
                          ),
                        })
                      }
                    />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </details>
        <details className="request-results-group" open>
          <summary>
            {t("Campos visibles (")}
            {config.resultColumns.length})
          </summary>
          <section className="request-page-results-section">
            <div className="request-page-results-section-heading">
              <div>
                <h4>{t("Columnas de resultados")}</h4>
                <p className="studio-field-help">{t(resultColumnsHelp)}</p>
              </div>
              <div className="request-results-column-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...config,
                      resultColumns: DEFAULT_RESULT_COLUMNS.map((column) => ({
                        ...column,
                        label: t(
                          column.label as keyof typeof automationMessages,
                        ),
                      })),
                    })
                  }
                >
                  {t("Restablecer")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={config.resultColumns.length >= 12}
                  onClick={() =>
                    onChange({
                      ...config,
                      resultColumns: [
                        ...config.resultColumns,
                        nextPresetColumn(config.resultColumns),
                      ],
                    })
                  }
                >
                  <Plus size={14} aria-hidden="true" />
                  {t("Añadir columna")}
                </Button>
              </div>
            </div>

            {config.resultColumns.length === 0 ? (
              <p className="studio-field-help">
                {t(
                  "Añade al menos una columna para mostrar datos de cada resultado.",
                )}
              </p>
            ) : (
              <ol
                className="request-results-column-list"
                aria-label={t("Columnas de resultados")}
              >
                {config.resultColumns.map((column, index) => {
                  const preset = presetValue(column);
                  const pointerValid = isValidResultColumnPointer(
                    column.pointer,
                  );
                  return (
                    <li
                      key={index}
                      className={[
                        "request-results-column-item",
                        draggingIndex === index ? "is-dragging" : "",
                        dropTargetIndex === index ? "is-drop-target" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onDragOver={(event) => {
                        if (draggingIndex === null) return;
                        event.preventDefault();
                        setDropTargetIndex(index);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const source = Number(
                          event.dataTransfer.getData(dragType),
                        );
                        if (!Number.isNaN(source)) moveColumn(source, index);
                        setDraggingIndex(null);
                        setDropTargetIndex(null);
                      }}
                    >
                      <button
                        type="button"
                        className="request-results-column-grip"
                        aria-label={t("Reordenar columna %{value0}", {
                          value0: column.label,
                        })}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(dragType, String(index));
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingIndex(index);
                        }}
                        onDragEnd={() => {
                          setDraggingIndex(null);
                          setDropTargetIndex(null);
                        }}
                      >
                        <GripVertical size={15} aria-hidden="true" />
                      </button>
                      <label className="studio-control request-results-column-field">
                        <span>{t("Etiqueta")}</span>
                        <Input
                          aria-label={t("Etiqueta de columna %{value0}", {
                            value0: index + 1,
                          })}
                          value={column.label}
                          maxLength={80}
                          onChange={(event) =>
                            updateColumn(index, { label: event.target.value })
                          }
                        />
                      </label>
                      <details className="request-results-column-options">
                        <summary>
                          {t("Datos y formato")}{" "}
                          <span>
                            {column.pointer} ·{" "}
                            {t(
                              RESULT_COLUMN_FORMAT_LABELS[
                                column.format
                              ] as keyof typeof automationMessages,
                            )}
                          </span>
                        </summary>
                        <div className="request-results-column-options-body">
                          <label className="studio-control request-results-column-field">
                            <span>{t("Campo del resultado")}</span>
                            <select
                              aria-label={t("Campo del resultado %{value0}", {
                                value0: index + 1,
                              })}
                              value={preset}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (value === "__custom__") return;
                                const match = RESULT_COLUMN_PRESETS.find(
                                  (entry) => entry.pointer === value,
                                );
                                if (match)
                                  updateColumn(index, {
                                    ...match,
                                    label: t(
                                      match.label as keyof typeof automationMessages,
                                    ),
                                  });
                              }}
                            >
                              {RESULT_COLUMN_PRESETS.map((entry) => (
                                <option
                                  key={entry.pointer}
                                  value={entry.pointer}
                                >
                                  {t(
                                    entry.label as keyof typeof automationMessages,
                                  )}{" "}
                                  ({entry.pointer})
                                </option>
                              ))}
                              <option value="__custom__">
                                {t("Personalizado…")}
                              </option>
                            </select>
                          </label>
                          {preset === "__custom__" ? (
                            <label className="studio-control request-results-column-field">
                              <span>{t("Ruta JSON")}</span>
                              <Input
                                aria-label={t(
                                  "Ruta JSON de columna %{value0}",
                                  { value0: index + 1 },
                                )}
                                value={column.pointer}
                                placeholder={t("/product/name")}
                                aria-invalid={pointerValid ? undefined : true}
                                onChange={(event) =>
                                  updateColumn(index, {
                                    pointer: event.target.value,
                                  })
                                }
                              />
                              {!pointerValid ? (
                                <span
                                  className="request-results-field-error"
                                  role="alert"
                                >
                                  {t("Usa una ruta como /product/name")}
                                </span>
                              ) : null}
                            </label>
                          ) : null}
                          <label className="studio-control request-results-column-field request-results-column-field--format">
                            <span>{t("Formato")}</span>
                            <select
                              aria-label={t("Formato de columna %{value0}", {
                                value0: index + 1,
                              })}
                              value={column.format}
                              onChange={(event) =>
                                updateColumn(index, {
                                  format: event.target
                                    .value as ResultColumnFormat,
                                })
                              }
                            >
                              {(
                                Object.keys(
                                  RESULT_COLUMN_FORMAT_LABELS,
                                ) as ResultColumnFormat[]
                              ).map((format) => (
                                <option key={format} value={format}>
                                  {t(
                                    RESULT_COLUMN_FORMAT_LABELS[
                                      format
                                    ] as keyof typeof automationMessages,
                                  )}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </details>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="request-results-column-remove"
                        aria-label={t("Eliminar columna %{value0}", {
                          value0: column.label,
                        })}
                        onClick={() => removeColumn(index)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </details>
        {(config.resultLayout === "html" ||
          config.resultLayout === "react") && (
          <section className="request-page-results-section">
            <h4>{t("Componente de resultados")}</h4>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHtmlDraft(
                  config.resultLayout === "react"
                    ? config.resultReact || RESULT_REACT_EXAMPLE
                    : config.resultHtml?.trim()
                      ? config.resultHtml
                      : resultHtmlExample(config.resultColumns),
                );
                setHtmlOpen(true);
              }}
            >
              {t("Editar")} {config.resultLayout === "react" ? "React" : "HTML"}
            </Button>
            <Dialog open={htmlOpen} onOpenChange={setHtmlOpen}>
              <DialogContent className="form-html-editor-dialog">
                <DialogHeader>
                  <DialogTitle>{t("Componente de resultados")}</DialogTitle>
                  <DialogDescription>
                    {t(
                      "Edita toda el área de resultados con HTML, CSS y JavaScript. Aplica los cambios para revisarlos en Vista previa; Publicar los guarda en la pantalla.",
                    )}
                  </DialogDescription>
                </DialogHeader>
                {htmlOpen && (
                  <MonacoCodeEditor
                    language={
                      config.resultLayout === "react" ? "typescript" : "html"
                    }
                    ariaLabel={t("HTML personalizado de resultados")}
                    height={420}
                    value={htmlDraft}
                    onChange={setHtmlDraft}
                  />
                )}
                <details>
                  <summary>
                    {t("Propiedades disponibles del componente")}
                  </summary>
                  <p className="studio-field-help">
                    {t(
                      "React recibe estas propiedades. En HTML están disponibles en window.savia.",
                    )}
                  </p>
                  <ul className="text-sm space-y-1">
                    <li>
                      <code>locale: "es" | "en" | "pt"</code>
                    </li>
                    <li>
                      <code>
                        {'t({ hello: ["Hola", "Hello", "Olá"] }, "hello")'}
                      </code>
                    </li>
                    <li>
                      <code>
                        {
                          'window.addEventListener("savia-locale-change", render)'
                        }
                      </code>
                    </li>
                    <li>
                      <code>rows[]</code>
                      {t(
                        ": id, title, status, date, simulation, values[], errors[], response.",
                      )}
                    </li>
                    <li>
                      <code>columns[]</code>
                      {t(": label, pointer, format.")}
                    </li>
                    <li>
                      <code>disabled</code>
                      {t(": indica si la acción de cargar está deshabilitada.")}
                    </li>
                    <li>
                      <code>load(id)</code>
                      {t(": carga los datos de un resultado en el formulario.")}
                    </li>
                    <li>
                      <code>React</code>
                      {t(
                        ": disponible globalmente, incluidos sus hooks. Exporta el componente con",
                      )}{" "}
                      <code>export default</code>.
                    </li>
                  </ul>
                  <h4>{t("Campos de esta pantalla")}</h4>
                  <ul className="text-sm">
                    {config.resultColumns.map((column, i) => (
                      <li key={i}>
                        <code>rows[n].values[{i}]</code> — {column.label} ·{" "}
                        {column.pointer} · {column.format}
                      </li>
                    ))}
                  </ul>
                </details>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setHtmlDraft(
                        config.resultLayout === "react"
                          ? RESULT_REACT_EXAMPLE
                          : resultHtmlExample(config.resultColumns),
                      )
                    }
                  >
                    {t("Cargar ejemplo completo")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setHtmlOpen(false)}
                  >
                    {t("Cancelar")}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      onChange(
                        config.resultLayout === "react"
                          ? { ...config, resultReact: htmlDraft }
                          : { ...config, resultHtml: htmlDraft },
                      );
                      setHtmlOpen(false);
                    }}
                  >
                    {t("Aplicar cambios")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>
        )}
      </TabsContent>
      <TabsContent value="preview">
        {config.resultColumns.length > 0 ||
        config.resultLayout === "react" ||
        config.resultLayout === "html" ? (
          <details className="request-results-preview" open>
            <summary>{t("Vista previa de resultados")}</summary>
            <p className="studio-field-help px-4">
              {t(
                "Datos de ejemplo. La presentación se actualiza al cambiar los ajustes.",
              )}
            </p>
            {config.resultLayout && config.resultLayout !== "table" ? (
              <div className="request-results-preview-content">
                <ResultCards
                  customReact={
                    config.resultLayout === "react"
                      ? config.resultReact || RESULT_REACT_EXAMPLE
                      : undefined
                  }
                  customHtml={
                    config.resultLayout === "html"
                      ? config.resultHtml?.trim()
                        ? config.resultHtml
                        : resultHtmlExample(config.resultColumns)
                      : undefined
                  }
                  comparison={
                    config.resultLayout === "comparison" ||
                    config.resultLayout === "html"
                  }
                  disabled
                  columns={config.resultColumns}
                  rows={[0, 1].map((index) => ({
                    id: `preview-${index}`,
                    title: t("Resultado de ejemplo %{value0}", {
                      value0: index + 1,
                    }),
                    status: t("Resultado disponible"),
                    date: "2026-01-01T12:00:00Z",
                    simulation: true,
                    values: config.resultColumns.map((column) =>
                      formatPreviewValue(
                        jsonPointer(SAMPLE_OFFER, column.pointer),
                        column.format,
                        SAMPLE_OFFER.premium.currency,
                      ),
                    ),
                    errors: [],
                    response: SAMPLE_OFFER,
                    onLoad: () => {},
                  }))}
                />
              </div>
            ) : (
              <div className="request-results-preview-table-wrap">
                <table className="request-results-preview-table">
                  <thead>
                    <tr>
                      <th>{t("Operación / fecha")}</th>
                      <th>{t("Estado")}</th>
                      {config.resultColumns.map((column, index) => (
                        <th key={`${column.pointer}:${index}`}>
                          {column.label}
                        </th>
                      ))}
                      <th>{t("Detalle")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>
                          {submitActions[0]
                            ? resolveRequestActionLabel(
                                submitActions[0],
                                labelLocale,
                              )
                            : t("Operación")}
                        </strong>
                        <small>{t("Ejemplo")}</small>
                      </td>
                      <td>{t("Resultado disponible")}</td>
                      {config.resultColumns.map((column, index) => (
                        <td key={`${column.pointer}:${index}`}>
                          {formatPreviewValue(
                            jsonPointer(SAMPLE_OFFER, column.pointer),
                            column.format,
                            SAMPLE_OFFER.premium.currency,
                          )}
                        </td>
                      ))}
                      <td>{t("Ver respuesta · Cargar datos")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </details>
        ) : (
          <p className="studio-field-help">
            {t("Añade campos en Configurar para ver la presentación.")}
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}
