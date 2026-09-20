import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import React, { useState, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Upload,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  ArrowLeft,
  Check,
  Sparkles,
  AlertCircle,
  Table,
  LoaderCircle,
  Kanban,
  Columns,
  Calculator,
  Link2,
  FolderTree,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "./api";
import {
  parseSpreadsheetFile,
  type ParsedSpreadsheet,
} from "./spreadsheet-parser";
import {
  inferSpreadsheetSchema,
  type InferredColumn,
} from "@savia/crm-shared/spreadsheet-inference";
import {
  screenNavigationSections,
  type RecordSurface,
  type ScreenNavigationIcon,
  type ScreenNavigationSection,
  type StudioConfig,
} from "@savia/crm-shared/metadata";
import { csvLine } from "@savia/crm-shared/csv";
import { LookupIconPicker } from "./lookup-icon-picker";
import "./collection-import-wizard.css";

type WizardStep = "upload" | "screen" | "fields" | "confirm";

type ExtendedColumn = InferredColumn & {
  included: boolean;
};

const FIELD_TYPES = [
  { value: "Textbox", label: "Texto corto" },
  { value: "Textarea", label: "Texto largo" },
  { value: "Number", label: "Número" },
  { value: "Currency", label: "Moneda ($ / €)" },
  { value: "DateControl", label: "Fecha" },
  { value: "Toggle", label: "Interruptor (Sí/No)" },
  { value: "Dropdown", label: "Menú desplegable" },
  { value: "Email", label: "Correo electrónico" },
  { value: "Phone", label: "Teléfono" },
  { value: "Url", label: "Enlace web (URL)" },
] as const;

const surfaceLabels: Record<RecordSurface, keyof typeof studioMessages> = {
  "drawer-long": "Panel lateral largo (Recomendado)",
  modal: "Ventana modal",
  drawer: "Panel lateral corto",
  page: "Página completa",
};

const screenNavigationSectionLabels: Record<
  ScreenNavigationSection,
  keyof typeof studioMessages
> = {
  operation: "Trabajo",
  productivity: "Construir",
  administration: "Administración",
  management: "Plataforma",
};

export function CollectionImportWizard({
  onClose,
  onCreated,
  onSwitchToBlank,
}: {
  onClose: () => void;
  onCreated: (name: string) => void | Promise<void>;
  onSwitchToBlank?: () => void;
}) {
  const t = useMessages(studioMessages);
  const [step, setStep] = useState<WizardStep>("upload");
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [error, setError] = useState("");

  // Known collections for relation detection
  const [knownCollections, setKnownCollections] = useState<
    Array<{ name: string; label: string }>
  >([]);
  const knownCollectionsRef = useRef<Array<{ name: string; label: string }>>(
    [],
  );
  knownCollectionsRef.current = knownCollections;

  useEffect(() => {
    Promise.resolve(
      api<{ data: Array<{ name: string; label: string }> }>("/objects"),
    )
      .then((res) => {
        if (Array.isArray(res?.data)) {
          const mapped = res.data.map((o) => ({
            name: o.name,
            label: o.label || o.name,
          }));
          setKnownCollections(mapped);
          knownCollectionsRef.current = mapped;
        }
      })
      .catch(() => {});
  }, []);

  // Parsed spreadsheet state
  const [spreadsheet, setSpreadsheet] = useState<ParsedSpreadsheet | null>(
    null,
  );
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  // Collection & Screen setup state
  const [collectionLabel, setCollectionLabel] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [menuSection, setMenuSection] =
    useState<ScreenNavigationSection>("operation");
  const [menuIcon, setMenuIcon] =
    useState<ScreenNavigationIcon>("file-spreadsheet");
  const [formMode, setFormMode] = useState<RecordSurface>("drawer-long");
  const [formColumns, setFormColumns] = useState<1 | 2>(2);

  // Sections layout state
  const [enableSections, setEnableSections] = useState(true);
  const [sections, setSections] = useState<{ id: string; label: string }[]>([]);

  // Pipeline detection state
  const [enablePipeline, setEnablePipeline] = useState(false);
  const [pipelineStageField, setPipelineStageField] = useState("");
  const [pipelineAmountField, setPipelineAmountField] = useState("");

  // Field columns state
  const [columns, setColumns] = useState<ExtendedColumn[]>([]);

  // Import options state
  const [importRows, setImportRows] = useState(true);

  // Drag and drop handler
  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setError("");
    setParsing(true);
    try {
      let currentKnown = knownCollectionsRef.current;
      if (currentKnown.length === 0) {
        try {
          const res = await Promise.resolve(
            api<{ data: Array<{ name: string; label: string }> }>("/objects"),
          );
          if (Array.isArray(res?.data)) {
            currentKnown = res.data.map((o) => ({
              name: o.name,
              label: o.label || o.name,
            }));
            setKnownCollections(currentKnown);
            knownCollectionsRef.current = currentKnown;
          }
        } catch {}
      }

      const parsed = await parseSpreadsheetFile(file);
      setSpreadsheet(parsed);
      setSelectedSheet(parsed.selectedSheet);

      // Run inference
      processInferredSchema(
        parsed,
        file.name,
        parsed.selectedSheet,
        currentKnown,
        enableSections,
      );
    } catch (err) {
      setError((err as Error).message || t("No se pudo leer el archivo."));
    } finally {
      setParsing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    multiple: false,
  });

  const handleSheetChange = (newSheet: string) => {
    if (!spreadsheet) return;
    setSelectedSheet(newSheet);
    processInferredSchema(
      spreadsheet,
      spreadsheet.fileName,
      newSheet,
      knownCollections,
      enableSections,
    );
  };

  const processInferredSchema = (
    parsed: ParsedSpreadsheet,
    fileName: string,
    sheetName: string,
    knownCols = knownCollections,
    withSections = enableSections,
  ) => {
    const inferred = inferSpreadsheetSchema({
      fileName,
      sheetName,
      headers: parsed.headers,
      rows: parsed.rows,
      knownCollections: knownCols,
      enableSections: withSections,
    });

    setCollectionLabel(inferred.collectionLabel);
    setCollectionName(inferred.collectionName);
    setCollectionDescription(inferred.description);
    setMenuSection(inferred.suggestedMenuSection);
    setMenuIcon(inferred.suggestedIcon);
    setFormColumns(inferred.config.studio?.columns === 1 ? 1 : 2);

    if (inferred.config.studio?.sections) {
      setSections(inferred.config.studio.sections);
    } else {
      setSections([]);
    }

    if (inferred.suggestedPipeline) {
      setEnablePipeline(true);
      setPipelineStageField(inferred.suggestedPipeline.field);
      setPipelineAmountField(inferred.suggestedPipeline.amountField || "");
    } else {
      setEnablePipeline(false);
      setPipelineStageField("");
      setPipelineAmountField("");
    }

    setColumns(
      inferred.columns.map((c) => ({
        ...c,
        included: true,
      })),
    );
  };

  // Submit / create collection & screen
  const handleCreate = async () => {
    setBusy(true);
    setError("");
    setImportProgress(0);
    setStatusMessage(t("Creando colección y pantalla en Savia..."));

    try {
      const includedColumns = columns.filter((c) => c.included);
      if (includedColumns.length === 0) {
        throw new Error(
          t("Debes incluir al menos un campo para crear la colección."),
        );
      }

      // Build fields config
      const fields: Record<string, any> = {};
      const fieldOrder: string[] = [];

      for (const col of includedColumns) {
        fields[col.key] = {
          type: col.type,
          label: col.label,
          required: col.required,
          ...(col.options && col.options.length > 0
            ? { options: col.options }
            : {}),
          ...(col.config ? { config: col.config } : {}),
        };
        fieldOrder.push(col.key);
      }

      const studio: StudioConfig = {
        screen: {
          hidden: false,
          section: menuSection,
          icon: menuIcon,
          createMode: formMode,
          editMode: formMode,
        },
        columns: formColumns,
        ...(enableSections && sections.length > 0 ? { sections } : {}),
        ...(enablePipeline && pipelineStageField
          ? {
              pipeline: {
                field: pipelineStageField,
                ...(pipelineAmountField
                  ? { amountField: pipelineAmountField }
                  : {}),
              },
            }
          : {}),
      };

      // 1. Create Object
      await api("/objects", "POST", {
        name: collectionName,
        label: collectionLabel,
        description: collectionDescription,
        config: {
          version: 2,
          fields,
          fieldOrder,
          studio,
        },
      });

      // 2. Import Initial Data with Chunked Sequential Batching (> 1,000 rows)
      if (importRows && spreadsheet && spreadsheet.rows.length > 0) {
        const BATCH_SIZE = 1000;
        const allRows = spreadsheet.rows;
        const totalBatches = Math.ceil(allRows.length / BATCH_SIZE);

        const mapping: Record<string, string> = {};
        for (const col of includedColumns) {
          mapping[col.originalHeader] = col.key;
        }

        for (let b = 0; b < totalBatches; b++) {
          const startIdx = b * BATCH_SIZE;
          const endIdx = Math.min(startIdx + BATCH_SIZE, allRows.length);
          const chunk = allRows.slice(startIdx, endIdx);
          const currentBatch = b + 1;

          setImportProgress(Math.round((b / totalBatches) * 100));
          setStatusMessage(
            totalBatches > 1
              ? t(
                  "Importando lote %{v1} de %{v2} (%{v3} de %{v4} registros)...",
                  {
                    v1: currentBatch,
                    v2: totalBatches,
                    v3: endIdx,
                    v4: allRows.length,
                  },
                )
              : t("Importando %{v1} registros en %{v2}...", {
                  v1: chunk.length,
                  v2: collectionLabel,
                }),
          );

          const csvPayload =
            "\uFEFF" +
            csvLine(spreadsheet.headers) +
            chunk.map((r) => csvLine(r)).join("");

          const previewRes = await api<{ importId: string }>(
            `/import/${collectionName}/preview`,
            "POST",
            {
              csv: csvPayload,
              mapping,
            },
          );

          if (previewRes?.importId) {
            await api(`/import/${collectionName}/commit`, "POST", {
              csv: csvPayload,
              mapping,
              importId: previewRes.importId,
            });
          }
        }
        setImportProgress(100);
      }

      toast.success(
        t('Colección y Pantalla "%{v1}" creadas con éxito', {
          v1: collectionLabel,
        }),
      );
      await onCreated(collectionName);
    } catch (e) {
      setError(
        (e as Error).message || t("Ocurrió un error al crear la colección."),
      );
    } finally {
      setBusy(false);
      setStatusMessage("");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="import-wizard-dialog">
        <DialogHeader className="import-wizard-header">
          <div className="import-wizard-title-row">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                <Sparkles className="text-emerald-700" size={22} />
                {t("Crear Colección y Pantalla desde Archivo")}
              </DialogTitle>
              <DialogDescription>
                {t(
                  "Convierte tus datos de Excel o CSV en una pantalla completamente funcional en segundos.",
                )}
              </DialogDescription>
            </div>
          </div>

          {/* Stepper */}
          <div className="import-wizard-stepper">
            <div
              className={`import-wizard-step-item ${
                step === "upload" ? "active" : spreadsheet ? "completed" : ""
              }`}
            >
              <div className="import-wizard-step-number">
                {spreadsheet && step !== "upload" ? <Check size={12} /> : "1"}
              </div>
              <span>{t("Archivo")}</span>
            </div>
            <div className="import-wizard-step-divider" />

            <div
              className={`import-wizard-step-item ${
                step === "screen"
                  ? "active"
                  : step === "fields" || step === "confirm"
                    ? "completed"
                    : ""
              }`}
            >
              <div className="import-wizard-step-number">
                {step === "fields" || step === "confirm" ? (
                  <Check size={12} />
                ) : (
                  "2"
                )}
              </div>
              <span>{t("Pantalla")}</span>
            </div>
            <div className="import-wizard-step-divider" />

            <div
              className={`import-wizard-step-item ${
                step === "fields"
                  ? "active"
                  : step === "confirm"
                    ? "completed"
                    : ""
              }`}
            >
              <div className="import-wizard-step-number">
                {step === "confirm" ? <Check size={12} /> : "3"}
              </div>
              <span>{t("Campos y Tipos")}</span>
            </div>
            <div className="import-wizard-step-divider" />

            <div
              className={`import-wizard-step-item ${
                step === "confirm" ? "active" : ""
              }`}
            >
              <div className="import-wizard-step-number">4</div>
              <span>{t("Confirmar")}</span>
            </div>
          </div>
        </DialogHeader>

        <div className="import-wizard-body">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: UPLOAD */}
          {step === "upload" && (
            <>
              {!spreadsheet ? (
                <>
                  <div
                    {...getRootProps()}
                    className={`wizard-dropzone ${isDragActive ? "drag-active" : ""}`}
                  >
                    <input {...getInputProps()} />
                    <div className="wizard-dropzone-icon">
                      <Upload size={24} />
                    </div>
                    <h4>
                      {t(
                        "Arrastra y suelta tu archivo Excel (.xlsx, .xls) o CSV",
                      )}
                    </h4>
                    <p>{t("o haz clic para explorar tus documentos")}</p>
                    <span className="text-xs text-muted-foreground mt-3">
                      {t(
                        "Inferencia automática de tipos, fechas, monedas, fórmulas y relaciones",
                      )}
                    </span>
                  </div>
                  {onSwitchToBlank && (
                    <div className="flex items-center justify-center pt-2">
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                        onClick={onSwitchToBlank}
                      >
                        {t(
                          "¿Prefieres diseñar un objeto en blanco desde cero? Haz clic aquí",
                        )}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="wizard-file-card">
                    <div className="wizard-file-info">
                      <FileSpreadsheet size={28} className="wizard-file-icon" />
                      <div>
                        <div className="wizard-file-name">
                          {spreadsheet.fileName}
                        </div>
                        <div className="wizard-file-meta">
                          <span>
                            {spreadsheet.totalRowsCount} {t("registros")}
                          </span>
                          <span>•</span>
                          <span>
                            {spreadsheet.headers.length}{" "}
                            {t("columnas detectadas")}
                          </span>
                          {spreadsheet.totalRowsCount > 1000 && (
                            <>
                              <span>•</span>
                              <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs border border-amber-200 font-medium">
                                {Math.ceil(spreadsheet.totalRowsCount / 1000)}{" "}
                                {t("lotes automáticos")}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSpreadsheet(null)}
                    >
                      {t("Cambiar archivo")}
                    </Button>
                  </div>

                  {spreadsheet.sheetNames.length > 1 && (
                    <div className="wizard-card-option">
                      <div>
                        <Label className="font-semibold text-sm">
                          {t("Hoja de cálculo activa")}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "Este libro contiene varias pestañas. Selecciona la que deseas convertir en pantalla.",
                          )}
                        </p>
                      </div>
                      <select
                        className="border rounded p-1 text-sm bg-white"
                        value={selectedSheet}
                        onChange={(e) => handleSheetChange(e.target.value)}
                      >
                        {spreadsheet.sheetNames.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-start gap-3">
                    <Sparkles
                      className="text-emerald-700 mt-0.5 shrink-0"
                      size={18}
                    />
                    <div>
                      <p className="font-semibold">
                        {t("Inferencia de esquema lista")}
                      </p>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        {t("Detectamos")} {columns.length}{" "}
                        {t("campos tipados listos para diseñar tu pantalla.")}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* STEP 2: SCREEN CONFIGURATION */}
          {step === "screen" && (
            <div className="flex flex-col gap-4">
              <div className="wizard-form-grid">
                <div className="wizard-field">
                  <Label htmlFor="col-label">
                    {t("Nombre visible de la Colección")}
                  </Label>
                  <Input
                    id="col-label"
                    value={collectionLabel}
                    onChange={(e) => {
                      setCollectionLabel(e.target.value);
                      setCollectionName(
                        e.target.value
                          .normalize("NFD")
                          .replace(/[\u0300-\u036f]/g, "")
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "_"),
                      );
                    }}
                    required
                  />
                </div>

                <div className="wizard-field">
                  <Label htmlFor="col-name">
                    {t("Identificador interno (slug)")}
                  </Label>
                  <Input
                    id="col-name"
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    pattern="[a-z][a-z0-9_]{0,47}"
                    required
                  />
                </div>

                <div className="wizard-field wizard-field-full">
                  <Label htmlFor="col-desc">{t("Descripción")}</Label>
                  <Input
                    id="col-desc"
                    value={collectionDescription}
                    onChange={(e) => setCollectionDescription(e.target.value)}
                    placeholder={t("Describe el propósito de esta pantalla...")}
                  />
                </div>

                <div className="wizard-field">
                  <Label htmlFor="menu-section">
                    {t("Sección en el Menú lateral")}
                  </Label>
                  <select
                    id="menu-section"
                    value={menuSection}
                    onChange={(e) =>
                      setMenuSection(e.target.value as ScreenNavigationSection)
                    }
                  >
                    {screenNavigationSections.map((sec) => (
                      <option key={sec} value={sec}>
                        {t(screenNavigationSectionLabels[sec])}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="wizard-field">
                  <Label>{t("Icono del menú lateral")}</Label>
                  <LookupIconPicker
                    value={menuIcon}
                    onChange={setMenuIcon}
                    libraries={["lucide"]}
                  />
                </div>

                <div className="wizard-field">
                  <Label htmlFor="form-mode">
                    {t("Superficie del Formulario")}
                  </Label>
                  <select
                    id="form-mode"
                    value={formMode}
                    onChange={(e) =>
                      setFormMode(e.target.value as RecordSurface)
                    }
                  >
                    {(
                      [
                        "drawer-long",
                        "drawer",
                        "modal",
                        "page",
                      ] as RecordSurface[]
                    ).map((m) => (
                      <option key={m} value={m}>
                        {t(surfaceLabels[m])}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="wizard-field">
                  <Label htmlFor="form-cols">
                    {t("Distribución de columnas")}
                  </Label>
                  <select
                    id="form-cols"
                    value={formColumns}
                    onChange={(e) =>
                      setFormColumns(Number(e.target.value) as 1 | 2)
                    }
                  >
                    <option value={1}>
                      {t("1 columna (vertical compacto)")}
                    </option>
                    <option value={2}>{t("2 columnas (balanceado)")}</option>
                  </select>
                </div>
              </div>

              {/* Form Sections Option */}
              <div className="wizard-card-option">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <FolderTree size={16} className="text-emerald-700" />
                    <span>{t("Organizar campos en Secciones")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {sections.length > 0
                      ? t(
                          "Agrupa los campos en %{v1} bloques temáticos (Información General, Contacto, Valores, Estado).",
                          { v1: sections.length },
                        )
                      : t(
                          "Agrupa los campos automáticamente en bloques visuales colapsables en el formulario.",
                        )}
                  </p>
                </div>
                <Switch
                  checked={enableSections}
                  onCheckedChange={(checked) => {
                    setEnableSections(checked);
                    if (spreadsheet) {
                      processInferredSchema(
                        spreadsheet,
                        spreadsheet.fileName,
                        selectedSheet,
                        knownCollections,
                        checked,
                      );
                    }
                  }}
                />
              </div>

              {/* Kanban Pipeline Option */}
              <div className="wizard-card-option">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <Kanban size={16} className="text-emerald-700" />
                    <span>{t("Vista Pipeline Kanban")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Habilita un tablero visual de tarjetas agrupadas por fases comerciales o estados.",
                    )}
                  </p>
                </div>
                <Switch
                  checked={enablePipeline}
                  onCheckedChange={setEnablePipeline}
                />
              </div>

              {enablePipeline && (
                <div className="p-4 bg-white border border-border rounded-lg grid grid-cols-2 gap-4">
                  <div className="wizard-field">
                    <Label>{t("Campo de etapa / estado")}</Label>
                    <select
                      value={pipelineStageField}
                      onChange={(e) => setPipelineStageField(e.target.value)}
                    >
                      <option value="">{t("Selecciona campo...")}</option>
                      {columns
                        .filter(
                          (c) => c.type === "Dropdown" || c.type === "Textbox",
                        )
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label} ({c.key})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="wizard-field">
                    <Label>{t("Campo de importe (opcional)")}</Label>
                    <select
                      value={pipelineAmountField}
                      onChange={(e) => setPipelineAmountField(e.target.value)}
                    >
                      <option value="">{t("Ninguno")}</option>
                      {columns
                        .filter(
                          (c) => c.type === "Currency" || c.type === "Number",
                        )
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label} ({c.key})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: FIELDS TABLE */}
          {step === "fields" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  {t(
                    "Configura tipos, relaciones y fórmulas detectadas. Desmarca columnas que no desees incluir.",
                  )}
                </span>
                <span>
                  {columns.filter((c) => c.included).length} {t("de")}{" "}
                  {columns.length} {t("campos activos")}
                </span>
              </div>

              <div className="wizard-table-container">
                <div className="wizard-table-scroll">
                  <table className="wizard-fields-table">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}></th>
                        <th>{t("Etiqueta en pantalla")}</th>
                        <th>{t("Identificador")}</th>
                        <th>{t("Tipo de dato")}</th>
                        <th>{t("Obligatorio")}</th>
                        <th>{t("Muestra de datos")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((col, index) => (
                        <tr
                          key={col.key}
                          className={!col.included ? "row-excluded" : ""}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={col.included}
                              onChange={(e) => {
                                const next = [...columns];
                                next[index] = {
                                  ...col,
                                  included: e.target.checked,
                                };
                                setColumns(next);
                              }}
                              className="rounded cursor-pointer"
                            />
                          </td>
                          <td>
                            <Input
                              value={col.label}
                              disabled={!col.included}
                              onChange={(e) => {
                                const next = [...columns];
                                next[index] = {
                                  ...col,
                                  label: e.target.value,
                                };
                                setColumns(next);
                              }}
                              className="h-8 text-xs font-medium"
                            />
                            {enableSections && col.section && (
                              <div className="mt-1">
                                <span className="wizard-section-badge">
                                  {sections.find((s) => s.id === col.section)
                                    ?.label || col.section}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="wizard-key-badge">{col.key}</span>
                          </td>
                          <td>
                            <div className="flex flex-col gap-1.5">
                              <select
                                value={col.type}
                                disabled={!col.included}
                                onChange={(e) => {
                                  const next = [...columns];
                                  next[index] = {
                                    ...col,
                                    type: e.target.value as any,
                                  };
                                  setColumns(next);
                                }}
                                className="wizard-type-select"
                              >
                                {FIELD_TYPES.map((ft) => (
                                  <option key={ft.value} value={ft.value}>
                                    {t(ft.label as keyof typeof studioMessages)}
                                  </option>
                                ))}
                              </select>

                              {col.formula && (
                                <span
                                  className="wizard-formula-badge"
                                  title={t(
                                    "Fórmula calculada automáticamente: %{v1}",
                                    {
                                      v1: col.formula.fields.join(
                                        ` ${t("y")} `,
                                      ),
                                    },
                                  )}
                                >
                                  <Calculator size={11} />
                                  {col.formula.op === "product"
                                    ? `${col.formula.fields[0]} × ${col.formula.fields[1]}`
                                    : col.formula.op === "sum"
                                      ? `${col.formula.fields[0]} + ${col.formula.fields[1]}`
                                      : col.formula.op === "difference"
                                        ? `${col.formula.fields[0]} - ${col.formula.fields[1]}`
                                        : `${col.formula.fields[0]} / ${col.formula.fields[1]}`}
                                </span>
                              )}

                              {col.relation && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="wizard-relation-badge">
                                    <Link2 size={11} /> {t("Relación:")}
                                  </span>
                                  <select
                                    className="text-[11px] h-6 border rounded px-1 bg-white max-w-[130px]"
                                    value={col.relation?.targetObject || ""}
                                    onChange={(e) => {
                                      const target = e.target.value;
                                      const next = [...columns];
                                      if (!target) {
                                        delete next[index].relation;
                                        delete next[index].config?.relation;
                                        delete next[index].config
                                          ?.collectionRelation;
                                      } else {
                                        next[index].relation = {
                                          targetObject: target,
                                        };
                                        next[index].config = {
                                          ...next[index].config,
                                          relation: target,
                                          collectionRelation: "manual",
                                        };
                                      }
                                      setColumns(next);
                                    }}
                                  >
                                    <option value="">
                                      {t("(Sin relación)")}
                                    </option>
                                    {knownCollections.map((kc) => (
                                      <option key={kc.name} value={kc.name}>
                                        {kc.label} ({kc.name})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="text-center">
                            <Switch
                              checked={col.required}
                              disabled={!col.included}
                              onCheckedChange={(checked) => {
                                const next = [...columns];
                                next[index] = {
                                  ...col,
                                  required: checked,
                                };
                                setColumns(next);
                              }}
                            />
                          </td>
                          <td>
                            <div className="flex items-center">
                              {col.sampleValues.length > 0 ? (
                                col.sampleValues.map((val, vi) => (
                                  <span
                                    key={vi}
                                    className="wizard-sample-badge"
                                  >
                                    {val}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground italic">
                                  {t("vacío")}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: CONFIRMATION */}
          {step === "confirm" && (
            <div className="flex flex-col gap-4">
              <div className="wizard-summary-card">
                <h4 className="font-semibold text-base text-foreground">
                  {t("Resumen de la nueva Pantalla")}
                </h4>

                <div className="wizard-summary-grid">
                  <div className="wizard-summary-metric">
                    <div className="wizard-summary-metric-label">
                      {t("Colección")}
                    </div>
                    <div className="wizard-summary-metric-val">
                      {collectionLabel}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">
                      {collectionName}
                    </span>
                  </div>

                  <div className="wizard-summary-metric">
                    <div className="wizard-summary-metric-label">
                      {t("Menú lateral")}
                    </div>
                    <div className="wizard-summary-metric-val capitalize">
                      {t(screenNavigationSectionLabels[menuSection])}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t("Icono:")} {menuIcon}
                    </span>
                  </div>

                  <div className="wizard-summary-metric">
                    <div className="wizard-summary-metric-label">
                      {t("Campos")}
                    </div>
                    <div className="wizard-summary-metric-val">
                      {columns.filter((c) => c.included).length}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {columns.filter((c) => !c.included).length}{" "}
                      {t("excluidos")}
                    </span>
                  </div>

                  <div className="wizard-summary-metric">
                    <div className="wizard-summary-metric-label">
                      {t("Registros")}
                    </div>
                    <div className="wizard-summary-metric-val">
                      {spreadsheet?.totalRowsCount ?? 0}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t("en el archivo")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Data Import Toggle */}
              <div className="wizard-card-option">
                <div className="space-y-1">
                  <Label className="font-semibold text-sm">
                    {t("¿Importar los registros iniciales ahora?")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {importRows
                      ? t(
                          "Se crearán %{v1} registros en la pantalla inmediatamente%{v2}",
                          {
                            v1: spreadsheet?.totalRowsCount ?? 0,
                            v2:
                              (spreadsheet?.totalRowsCount ?? 0) > 1000
                                ? t(" (en %{v1} lotes secuenciales).", {
                                    v1: Math.ceil(
                                      (spreadsheet?.totalRowsCount ?? 0) / 1000,
                                    ),
                                  })
                                : ".",
                          },
                        )
                      : t(
                          "Se creará la pantalla vacía, lista para capturar nuevos registros.",
                        )}
                  </p>
                </div>
                <Switch
                  checked={importRows}
                  onCheckedChange={setImportRows}
                  disabled={busy}
                />
              </div>

              {busy && (
                <div className="flex flex-col gap-3 p-4 bg-emerald-50/90 border border-emerald-200 rounded-lg text-emerald-900">
                  <div className="flex items-center gap-3">
                    <LoaderCircle
                      className="animate-spin text-emerald-700 shrink-0"
                      size={20}
                    />
                    <div>
                      <p className="font-semibold text-sm">{statusMessage}</p>
                      <p className="text-xs text-emerald-700">
                        {t("Procesando en base de datos D1. Por favor espera.")}
                      </p>
                    </div>
                  </div>

                  {spreadsheet && spreadsheet.rows.length > 0 && importRows && (
                    <div className="wizard-progress-box mt-2">
                      <div className="wizard-progress-header">
                        <span>{t("Progreso de importación")}</span>
                        <span>{importProgress}%</span>
                      </div>
                      <div className="wizard-progress-track">
                        <div
                          className="wizard-progress-bar"
                          style={{ width: `${importProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        <div className="import-wizard-footer">
          <div>
            {step !== "upload" ? (
              <Button
                variant="ghost"
                onClick={() => {
                  if (step === "screen") setStep("upload");
                  else if (step === "fields") setStep("screen");
                  else if (step === "confirm") setStep("fields");
                }}
                disabled={busy}
                className="gap-2"
              >
                <ArrowLeft size={16} />
                {t("Anterior")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                {t("Cancelar")}
              </Button>
            )}
          </div>

          <div className="wizard-button-group">
            {step === "upload" && (
              <Button
                className="wizard-button-primary gap-2"
                disabled={!spreadsheet || parsing}
                onClick={() => setStep("screen")}
              >
                {parsing ? (
                  <>
                    <LoaderCircle className="animate-spin" size={16} />
                    {t("Procesando...")}
                  </>
                ) : (
                  <>
                    {t("Continuar a Pantalla")}
                    <ArrowRight size={16} />
                  </>
                )}
              </Button>
            )}

            {step === "screen" && (
              <Button
                className="wizard-button-primary gap-2"
                disabled={!collectionName || !collectionLabel}
                onClick={() => setStep("fields")}
              >
                {t("Revisar Campos (")}
                {columns.length})
                <ArrowRight size={16} />
              </Button>
            )}

            {step === "fields" && (
              <Button
                className="wizard-button-primary gap-2"
                disabled={columns.filter((c) => c.included).length === 0}
                onClick={() => setStep("confirm")}
              >
                {t("Confirmar e Importar")}
                <ArrowRight size={16} />
              </Button>
            )}

            {step === "confirm" && (
              <Button
                className="wizard-button-primary gap-2"
                disabled={busy}
                onClick={handleCreate}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="animate-spin" size={16} />
                    {t("Creando...")}
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    {importRows
                      ? t("Crear e Importar %{v1} registros", {
                          v1: spreadsheet?.totalRowsCount ?? 0,
                        })
                      : t("Crear Colección y Pantalla")}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
