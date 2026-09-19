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

function formatPreviewValue(
  value: unknown,
  format: ResultColumnFormat,
  currency?: string | null,
) {
  if (value === null || value === undefined || value === "") {
    return "No informado";
  }
  if (format === "money" && Number.isFinite(Number(value))) {
    try {
      return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: currency ?? "COP",
      }).format(Number(value));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

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

function nextPresetColumn(columns: ResultColumn[]): ResultColumn {
  const used = new Set(columns.map((column) => column.pointer));
  const available = RESULT_COLUMN_PRESETS.find(
    (preset) => !used.has(preset.pointer),
  );
  if (available) return { ...available };
  return {
    label: `Columna ${columns.length + 1}`,
    pointer: "/reference",
    format: "text",
  };
}

export function RequestPageResultsEditor({
  config,
  onChange,
}: {
  config: RequestPageConfig;
  onChange: (config: RequestPageConfig) => void;
}) {
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
      <TabsList aria-label="Editor de resultados">
        <TabsTrigger value="configure">Configurar</TabsTrigger>
        <TabsTrigger value="preview">Vista previa</TabsTrigger>
      </TabsList>
      <TabsContent value="configure" className="request-results-configure">
        <details className="request-results-group" open>
          <summary>Presentación</summary>
          <label className="studio-control">
            <StudioControlLabel
              label="Presentación de resultados"
              help="Se guarda para esta pantalla. Las tarjetas y el comparador utilizan los campos configurados abajo."
            />
            <select
              aria-label="Presentación de resultados"
              value={config.resultLayout ?? "table"}
              onChange={(event) =>
                onChange({
                  ...config,
                  resultLayout: event.target
                    .value as RequestPageConfig["resultLayout"],
                })
              }
            >
              <option value="table">Tabla e historial</option>
              <option value="cards">Tarjetas</option>
              <option value="comparison">Tarjetas y comparación</option>
              <option value="html">HTML personalizado</option>
              <option value="react">React personalizado</option>
            </select>
          </label>
        </details>
        <details className="request-results-execution-settings request-results-group">
          <summary>Botón y nombres de operaciones</summary>
          <section className="request-page-results-section">
            <label className="studio-control">
              <StudioControlLabel
                label="Texto del botón principal"
                help={submitLabelHelp}
              />
              <Input
                aria-label="Texto del botón principal"
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
                <h4>Operaciones</h4>
                <p className="studio-field-help">{submitActionsHelp}</p>
              </div>
              <ol
                className="request-results-action-list"
                aria-label="Operaciones"
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
          <summary>Campos visibles ({config.resultColumns.length})</summary>
          <section className="request-page-results-section">
            <div className="request-page-results-section-heading">
              <div>
                <h4>Columnas de resultados</h4>
                <p className="studio-field-help">{resultColumnsHelp}</p>
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
                      })),
                    })
                  }
                >
                  Restablecer
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
                  Añadir columna
                </Button>
              </div>
            </div>

            {config.resultColumns.length === 0 ? (
              <p className="studio-field-help">
                Añade al menos una columna para mostrar datos de cada resultado.
              </p>
            ) : (
              <ol
                className="request-results-column-list"
                aria-label="Columnas de resultados"
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
                        aria-label={`Reordenar columna ${column.label}`}
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
                        <span>Etiqueta</span>
                        <Input
                          aria-label={`Etiqueta de columna ${index + 1}`}
                          value={column.label}
                          maxLength={80}
                          onChange={(event) =>
                            updateColumn(index, { label: event.target.value })
                          }
                        />
                      </label>
                      <details className="request-results-column-options">
                        <summary>
                          Datos y formato{" "}
                          <span>
                            {column.pointer} ·{" "}
                            {RESULT_COLUMN_FORMAT_LABELS[column.format]}
                          </span>
                        </summary>
                        <div className="request-results-column-options-body">
                          <label className="studio-control request-results-column-field">
                            <span>Campo del resultado</span>
                            <select
                              aria-label={`Campo del resultado ${index + 1}`}
                              value={preset}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (value === "__custom__") return;
                                const match = RESULT_COLUMN_PRESETS.find(
                                  (entry) => entry.pointer === value,
                                );
                                if (match) updateColumn(index, { ...match });
                              }}
                            >
                              {RESULT_COLUMN_PRESETS.map((entry) => (
                                <option
                                  key={entry.pointer}
                                  value={entry.pointer}
                                >
                                  {entry.label} ({entry.pointer})
                                </option>
                              ))}
                              <option value="__custom__">Personalizado…</option>
                            </select>
                          </label>
                          {preset === "__custom__" ? (
                            <label className="studio-control request-results-column-field">
                              <span>Ruta JSON</span>
                              <Input
                                aria-label={`Ruta JSON de columna ${index + 1}`}
                                value={column.pointer}
                                placeholder="/product/name"
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
                                  Usa una ruta como /product/name
                                </span>
                              ) : null}
                            </label>
                          ) : null}
                          <label className="studio-control request-results-column-field request-results-column-field--format">
                            <span>Formato</span>
                            <select
                              aria-label={`Formato de columna ${index + 1}`}
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
                                  {RESULT_COLUMN_FORMAT_LABELS[format]}
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
                        aria-label={`Eliminar columna ${column.label}`}
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
            <h4>Componente de resultados</h4>
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
              Editar {config.resultLayout === "react" ? "React" : "HTML"}
            </Button>
            <Dialog open={htmlOpen} onOpenChange={setHtmlOpen}>
              <DialogContent className="form-html-editor-dialog">
                <DialogHeader>
                  <DialogTitle>Componente de resultados</DialogTitle>
                  <DialogDescription>
                    Edita toda el área de resultados con HTML, CSS y JavaScript.
                    Aplica los cambios para revisarlos en Vista previa; Publicar
                    los guarda en la pantalla.
                  </DialogDescription>
                </DialogHeader>
                {htmlOpen && (
                  <MonacoCodeEditor
                    language={
                      config.resultLayout === "react" ? "typescript" : "html"
                    }
                    ariaLabel="HTML personalizado de resultados"
                    height={420}
                    value={htmlDraft}
                    onChange={setHtmlDraft}
                  />
                )}
                <details>
                  <summary>Propiedades disponibles del componente</summary>
                  <p className="studio-field-help">
                    React recibe estas propiedades. En HTML están disponibles en
                    window.savia.
                  </p>
                  <ul className="text-sm space-y-1">
                    <li>
                      <code>rows[]</code>: id, title, status, date, simulation,
                      values[], errors[], response.
                    </li>
                    <li>
                      <code>columns[]</code>: label, pointer, format.
                    </li>
                    <li>
                      <code>disabled</code>: indica si la acción de cargar está
                      deshabilitada.
                    </li>
                    <li>
                      <code>load(id)</code>: carga los datos de un resultado en
                      el formulario.
                    </li>
                    <li>
                      <code>React</code>: disponible globalmente, incluidos sus
                      hooks. Exporta el componente con{" "}
                      <code>export default</code>.
                    </li>
                  </ul>
                  <h4>Campos de esta pantalla</h4>
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
                    Cargar ejemplo completo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setHtmlOpen(false)}
                  >
                    Cancelar
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
                    Aplicar cambios
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
            <summary>Vista previa de resultados</summary>
            <p className="studio-field-help px-4">
              Datos de ejemplo. La presentación se actualiza al cambiar los
              ajustes.
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
                    title: `Resultado de ejemplo ${index + 1}`,
                    status: "Resultado disponible",
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
                      <th>Operación / fecha</th>
                      <th>Estado</th>
                      {config.resultColumns.map((column, index) => (
                        <th key={`${column.pointer}:${index}`}>
                          {column.label}
                        </th>
                      ))}
                      <th>Detalle</th>
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
                            : "Operación"}
                        </strong>
                        <small>Ejemplo</small>
                      </td>
                      <td>Resultado disponible</td>
                      {config.resultColumns.map((column, index) => (
                        <td key={`${column.pointer}:${index}`}>
                          {formatPreviewValue(
                            jsonPointer(SAMPLE_OFFER, column.pointer),
                            column.format,
                            SAMPLE_OFFER.premium.currency,
                          )}
                        </td>
                      ))}
                      <td>Ver respuesta · Cargar datos</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </details>
        ) : (
          <p className="studio-field-help">
            Añade campos en Configurar para ver la presentación.
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}
