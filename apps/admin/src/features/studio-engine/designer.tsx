import { LocalizedContentEditor } from "./localized-content-editor";
import { resolveOptionLabel } from "@savia/studio-shared/field-labels";
import {
  StaticOptionLabelsEditor,
  parseStaticOptions,
} from "./designer-option-labels";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import { localDateTime } from "./date-time-field";
import { RelatedPresentationSettings } from "./related-presentation-settings";
import { MonacoCodeEditor } from "./monaco-code-editor";
import { GroupedDesignerCanvas } from "./grouped-designer-canvas";
import { FormHtmlEditorModal } from "./form-html-editor-modal";
import { PaletteTypeSearch } from "./palette-field-search";
import {
  buildGroupedFieldOrder,
  designerPaletteDragType,
  resolvePaletteFieldId,
} from "./designer-field-dnd";
import { RequestActionsEditor } from "./request-actions-editor";
import {
  requestPageSchema,
  type RequestPageConfig,
} from "@savia/studio-shared/request-page";
import { collectionCapabilities } from "./collection-capabilities";
import { CollectionLayoutDesigner } from "./collection-sources-panel";
import { DependentOptionsEditor } from "./dependent-options";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DesignerProvider,
  useDesigner,
  createInitialDesignerState,
} from "@form-eng/designer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Save,
  Undo2,
  Redo2,
  History,
  Eye,
  Trash2,
  Braces,
  Settings2,
  Cog,
} from "lucide-react";
import {
  fieldTypeLabel,
  getLocalizedFieldTypePalette,
  filterPaletteFieldTypes,
} from "./field-type-icons";
import { toast } from "sonner";
import { api } from "./api";
import DynamicForm from "./dynamic-form";
import { LocalizedFieldLabelEditor } from "./localized-field-label-editor";
import { PropertyPanelSearch } from "./property-panel-search";
import { PropertySection } from "./property-section";
import { StudioControlLabel } from "./studio-control-label";
import { StudioHelpTooltip } from "./studio-help-tooltip";
import { usePropertyPanelFilter } from "./use-property-panel-filter";
import { propertySearchTerms } from "@savia/studio-shared/property-panel-search";
import { LookupActions } from "./lookup-actions";
import { executeRequestPageAction } from "./request-page-api";
import WizardDesigner from "./wizard-designer";
import { serviceCredentialsHref } from "./service-credentials";
import { RuleEditor, parseValue } from "./rule-editor";
import {
  defaultMapCenter,
  resolveMapPicker,
  type MapPickerSettings,
} from "@savia/studio-shared/map-location";
import {
  resolveFormHtml,
  type FormHtmlConfig,
} from "@savia/studio-shared/form-html";
import {
  FORM_HTML_TYPE,
  DISPLAY_TEXT_TYPE,
  R2_ATTACHMENT_TYPE,
  type StudioObject,
  type WizardConfig,
} from "@savia/studio-shared/metadata";
import {
  displayTextVariantLabels,
  displayTextVariants,
  resolveDisplayText,
  type DisplayTextConfig,
} from "@savia/studio-shared/display-text";
import type { Condition } from "@savia/studio-shared/rules";
import "./designer-vendor.css";
import "./designer-enhancements.css";
import "./request-wizard.css";

type Studio = {
  requestPage?: RequestPageConfig;
  wizard?: WizardConfig;
  columns: 1 | 2 | 3;
  sections: { id: string; label: string; visibleWhen?: Condition }[];
  pipeline?: {
    field: string;
    amountField?: string;
    ownerField?: string;
    wonValues?: string[];
    lostValues?: string[];
  };
};
type EditorMode = "design" | "preview" | "settings" | "versions" | "json";

const editorViews: {
  id: EditorMode;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "design", label: "Diseñar", icon: null },
  {
    id: "settings",
    label: "Ajustes",
    icon: <Settings2 size={14} aria-hidden="true" />,
  },
  {
    id: "preview",
    label: "Probar",
    icon: <Eye size={14} aria-hidden="true" />,
  },
  {
    id: "versions",
    label: "Versiones",
    icon: <History size={14} aria-hidden="true" />,
  },
  { id: "json", label: "JSON", icon: <Braces size={14} aria-hidden="true" /> },
];
function Control({
  label,
  children,
  searchTerms,
  help,
  helpLabel,
}: {
  label: string;
  children: ReactNode;
  searchTerms?: string;
  help?: ReactNode;
  helpLabel?: string;
}) {
  return (
    <label
      className="studio-control"
      data-property-search={propertySearchTerms(label, searchTerms)}
    >
      {help ? (
        <StudioControlLabel label={label} help={help} helpLabel={helpLabel} />
      ) : (
        <span>{label}</span>
      )}
      {children}
    </label>
  );
}
function Choice({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}
function Flag({
  label,
  value,
  onChange,
  searchTerms,
}: {
  label: string;
  value: unknown;
  onChange: (v: boolean) => void;
  searchTerms?: string;
}) {
  return (
    <label
      className="studio-flag"
      data-property-search={propertySearchTerms(label, searchTerms)}
    >
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
function Properties({
  objectName,
  studio,
  setStudio,
}: {
  objectName: string;
  studio: Studio;
  setStudio: (studio: Studio) => void;
}) {
  const t = useMessages(studioMessages);
  const locale = useAppLocale();
  const { state, selectedField, updateField, removeField } = useDesigner();
  const [formHtmlEditorOpen, setFormHtmlEditorOpen] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const propertiesBodyRef = useRef<HTMLDivElement>(null);
  const objects = useQuery({
    queryKey: ["objects"],
    queryFn: () => api("/objects"),
  });
  const id = state.selectedFieldId;
  const {
    empty: propertyFilterEmpty,
    matchCount,
    filtering,
  } = usePropertyPanelFilter(propertySearch, propertiesBodyRef, id ?? "");
  useEffect(() => {
    setPropertySearch("");
  }, [id]);
  if (!selectedField || !id)
    return (
      <aside className="studio-properties studio-properties--empty">
        <h3>{t("Propiedades")}</h3>
        <p className="studio-field-help">
          {t(
            "Selecciona un campo del formulario para configurar sus datos y comportamiento.",
          )}
        </p>
      </aside>
    );
  const field = selectedField;
  const config = field.config ?? {};
  const addressAutocomplete =
    typeof config.addressAutocomplete === "object" && config.addressAutocomplete
      ? (config.addressAutocomplete as {
          provider?: string;
          country?: string;
          language?: string;
        })
      : undefined;
  const isR2Attachment = field.type === R2_ATTACHMENT_TYPE;
  const isFormHtml = field.type === FORM_HTML_TYPE;
  const isDisplayText = field.type === DISPLAY_TEXT_TYPE;
  const formHtml = resolveFormHtml(config) ?? { html: "", script: "" };
  const displayText = resolveDisplayText(config) ?? {
    variant: "span" as const,
    content: "",
  };
  const patchDisplayText = (next: Partial<DisplayTextConfig>) =>
    patch("displayText", { ...displayText, ...next });
  const patchFormHtml = (next: Partial<FormHtmlConfig>) =>
    patch("formHtml", { ...formHtml, ...next });
  const mapPicker =
    field.type === "MapLocation" ? resolveMapPicker(config) : null;
  const patchMapPicker = (next: Partial<MapPickerSettings>) => {
    patch("mapPicker", { ...resolveMapPicker(config), ...next });
  };
  const patchConfig = (partial: Record<string, unknown>) =>
    updateField(id, { config: { ...config, ...partial } });
  const patch = (key: string, value: unknown) => patchConfig({ [key]: value });
  const numeric = (key: string, label: string) => (
    <Control label={label}>
      <Input
        type="number"
        value={String(config[key] ?? "")}
        onChange={(e) =>
          patch(key, e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
    </Control>
  );
  const hasAdvancedConfig =
    isR2Attachment ||
    isFormHtml ||
    isDisplayText ||
    field.type === "Number" ||
    field.type === "Currency" ||
    field.type === "Percentage" ||
    field.type === "Rating" ||
    (field.type === "MapLocation" && !!mapPicker) ||
    field.type === "Address" ||
    ["Email", "Phone", "Url", "Textbox", "Textarea"].includes(field.type) ||
    field.type === "Dropdown" ||
    field.type === "Autocomplete" ||
    field.type === "MultiSelect" ||
    field.type === "RichText";
  return (
    <aside className="studio-properties" key={id}>
      <div className="studio-properties-header">
        <div className="studio-properties-heading">
          <h3>{t("Propiedades del campo")}</h3>
          <span className="studio-properties-field-badge">
            {fieldTypeLabel(field.type, locale)}
          </span>
        </div>
        <PropertyPanelSearch
          query={propertySearch}
          onQueryChange={setPropertySearch}
          matchCount={matchCount}
          filtering={filtering}
        />
      </div>
      {propertyFilterEmpty ? (
        <p className="studio-property-filter-empty" role="status">
          {t("No hay propiedades que coincidan con «")}
          {propertySearch.trim()}».
        </p>
      ) : null}
      <div
        ref={propertiesBodyRef}
        className="studio-properties-body"
        data-filtering={filtering ? "true" : "false"}
      >
        {config.collectionRelation ? (
          <RelatedPresentationSettings
            objectName={objectName}
            config={config}
            objects={objects.data?.data ?? []}
            onChange={(next) => updateField(id, { config: next })}
          />
        ) : null}
        {studio.requestPage ? (
          <PropertySection
            title={t("Eventos y acciones")}
            searchTerms="consulta lookup botón acciones debounce icono request"
            help={t(
              "Configura el botón de consulta y, si lo necesitas, uno o varios eventos HTML del campo que ejecuten la misma acción. Se requiere una entrada con valor.",
            )}
          >
            <RequestActionsEditor
              fieldId={id}
              fields={state.fields}
              config={studio.requestPage}
              onChange={(requestPage) => setStudio({ ...studio, requestPage })}
            />
          </PropertySection>
        ) : null}
        <PropertySection
          title={t("Datos básicos")}
          searchTerms="etiqueta tipo ayuda identificador label id"
        >
          <p
            className="studio-field-id"
            data-property-search={propertySearchTerms(
              t("Identificador"),
              "id campo name",
            )}
          >
            {t("Identificador:")}
            <code>{id}</code>
          </p>
          <Control
            label={t("Etiqueta")}
            searchTerms="label traducción idioma es en pt"
          >
            <LocalizedFieldLabelEditor
              field={field}
              onChange={({ label, labels }) =>
                updateField(id, { label, labels })
              }
            />
          </Control>
          <Control label={t("Tipo")} searchTerms="type campo textbox número">
            <Choice
              value={field.type}
              onChange={(type) => {
                if (type !== R2_ATTACHMENT_TYPE) {
                  if (type === "Autocomplete") {
                    const {
                      formula,
                      multiple,
                      onDelete,
                      optionsWhen,
                      relation,
                      ...attachmentConfig
                    } = config;
                    void formula;
                    void multiple;
                    void onDelete;
                    void optionsWhen;
                    void relation;
                    updateField(id, {
                      type,
                      config: attachmentConfig,
                      options: field.options?.length
                        ? field.options
                        : [{ value: "opcion_1", label: t("Opción 1") }],
                    });
                    return;
                  }
                  if (type === FORM_HTML_TYPE) {
                    const {
                      addressAutocomplete,
                      mapPicker,
                      formHtml: _formHtml,
                      formula,
                      multiple,
                      onDelete,
                      optionsWhen,
                      relation,
                      requiredWhen,
                      unique,
                      ...rest
                    } = config;
                    void addressAutocomplete;
                    void mapPicker;
                    void _formHtml;
                    void formula;
                    void multiple;
                    void onDelete;
                    void optionsWhen;
                    void relation;
                    void requiredWhen;
                    void unique;
                    const sampleField =
                      Object.keys(state.fields).find(
                        (name) =>
                          name !== id && state.fields[name].type === "Textbox",
                      ) ?? "nombre";
                    updateField(id, {
                      type,
                      required: false,
                      readOnly: true,
                      defaultValue: undefined,
                      options: undefined,
                      config: {
                        ...rest,
                        formHtml: {
                          html: `<div class="form-html-block"><p>{{values.${sampleField}}}</p><button type="button" class="btn" data-savia-set-value="${sampleField}" data-savia-value="Ejemplo">Usar ejemplo</button></div>`,
                          script: "",
                        },
                      },
                    });
                    return;
                  }
                  if (type === DISPLAY_TEXT_TYPE) {
                    const {
                      addressAutocomplete,
                      displayText: _displayText,
                      formHtml,
                      formula,
                      mapPicker,
                      multiple,
                      onDelete,
                      optionsWhen,
                      relation,
                      requiredWhen,
                      unique,
                      ...rest
                    } = config;
                    void addressAutocomplete;
                    void _displayText;
                    void formHtml;
                    void formula;
                    void mapPicker;
                    void multiple;
                    void onDelete;
                    void optionsWhen;
                    void relation;
                    void requiredWhen;
                    void unique;
                    const sampleField =
                      Object.keys(state.fields).find(
                        (name) =>
                          name !== id && state.fields[name].type === "Textbox",
                      ) ?? "nombre";
                    updateField(id, {
                      type,
                      required: false,
                      readOnly: true,
                      defaultValue: undefined,
                      options: undefined,
                      config: {
                        ...rest,
                        displayText: {
                          variant: "span",
                          content: t("Hola {{values.%{v1}}}", {
                            v1: sampleField,
                          }),
                        },
                      },
                    });
                    return;
                  }
                  if (
                    [
                      "Email",
                      "Phone",
                      "Url",
                      "Address",
                      "MapLocation",
                    ].includes(type)
                  ) {
                    const { format, addressAutocomplete, mapPicker, ...rest } =
                      config;
                    void format;
                    if (type === "Address") {
                      updateField(id, {
                        type,
                        config:
                          field.type === "Address" && addressAutocomplete
                            ? { ...rest, addressAutocomplete }
                            : rest,
                      });
                      return;
                    }
                    if (type === "MapLocation") {
                      updateField(id, {
                        type,
                        config: {
                          ...rest,
                          mapPicker:
                            field.type === "MapLocation" && mapPicker
                              ? mapPicker
                              : {
                                  geolocation: true,
                                  reverseGeocode: true,
                                  zoom: 14,
                                  language: "es",
                                  provider: "photon",
                                },
                        },
                      });
                      return;
                    }
                    updateField(id, { type, config: rest });
                    return;
                  }
                  if (type === "Percentage" || type === "Rating") {
                    updateField(id, {
                      type,
                      defaultValue: undefined,
                      options: undefined,
                      config: {
                        ...config,
                        dateTime: undefined,
                        format: undefined,
                        formula: undefined,
                        multiple: undefined,
                        relation: undefined,
                        collectionRelation: undefined,
                        collectionOptions: undefined,
                        optionsWhen: undefined,
                        onDelete: undefined,
                        addressAutocomplete: undefined,
                        mapPicker: undefined,
                        formHtml: undefined,
                        displayText: undefined,
                        minimum: type === "Rating" ? 1 : 0,
                        maximum: type === "Rating" ? 5 : 100,
                        decimals: type === "Percentage" ? 2 : undefined,
                        ratingStyle: type === "Rating" ? "stars" : undefined,
                      },
                    });
                    return;
                  }
                  if (type === "MultiSelect" || type === "RichText") {
                    updateField(id, {
                      type,
                      defaultValue: undefined,
                      options:
                        type === "MultiSelect"
                          ? field.options?.length
                            ? field.options
                            : [{ value: "option_1", label: t("Opción 1") }]
                          : undefined,
                      config: {
                        section: config.section,
                        minLength:
                          type === "RichText" ? config.minLength : undefined,
                        maxLength:
                          type === "RichText" ? config.maxLength : undefined,
                      },
                    });
                    return;
                  }
                  if (type === "Currency") {
                    const {
                      addressAutocomplete,
                      mapPicker,
                      formHtml,
                      displayText,
                      ...rest
                    } = config;
                    void addressAutocomplete;
                    void mapPicker;
                    void formHtml;
                    void displayText;
                    updateField(id, {
                      type,
                      config: {
                        ...rest,
                        currency:
                          typeof config.currency === "string" && config.currency
                            ? config.currency
                            : "COP",
                        decimals:
                          typeof config.decimals === "number"
                            ? config.decimals
                            : 2,
                      },
                    });
                    return;
                  }
                  const { addressAutocomplete, mapPicker, formHtml, ...rest } =
                    config;
                  void addressAutocomplete;
                  void mapPicker;
                  void formHtml;
                  updateField(id, {
                    type,
                    config: type === "Address" ? config : rest,
                  });
                  return;
                }
                const {
                  formula,
                  multiple,
                  onDelete,
                  optionsWhen,
                  relation,
                  requiredWhen,
                  unique,
                  ...attachmentConfig
                } = config;
                void formula;
                void multiple;
                void onDelete;
                void optionsWhen;
                void relation;
                void requiredWhen;
                void unique;
                updateField(id, {
                  config: attachmentConfig,
                  defaultValue: undefined,
                  options: undefined,
                  required: false,
                  type,
                });
              }}
            >
              {getLocalizedFieldTypePalette(locale).map(({ type, label }) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </Choice>
          </Control>
          <Control label={t("Ayuda")} searchTerms="descripción hint tooltip">
            <Textarea
              value={field.description ?? ""}
              onChange={(e) => updateField(id, { description: e.target.value })}
            />
          </Control>
        </PropertySection>
        <PropertySection
          title={t("Comportamiento")}
          searchTerms="obligatorio lectura oculto único predeterminado required readonly hidden default"
        >
          {!isR2Attachment && !isFormHtml && !isDisplayText && (
            <>
              <Flag
                label={t("Obligatorio")}
                searchTerms="required requerido"
                value={field.required}
                onChange={(required) => updateField(id, { required })}
              />
              <Flag
                label={t("Valor único")}
                searchTerms="unique"
                value={config.unique}
                onChange={(v) => patch("unique", v)}
              />
            </>
          )}
          <Flag
            label={t("Solo lectura")}
            searchTerms="readonly read only"
            value={field.readOnly}
            onChange={(readOnly) => updateField(id, { readOnly })}
          />
          <Flag
            label={t("Oculto")}
            searchTerms="hidden invisible"
            value={field.hidden}
            onChange={(hidden) => updateField(id, { hidden })}
          />
          {!config.relation &&
            !isR2Attachment &&
            !isFormHtml &&
            !isDisplayText && (
              <Control
                label={t("Valor predeterminado")}
                searchTerms="default inicial"
              >
                {field.type === "Toggle" ? (
                  <Choice
                    value={String(field.defaultValue ?? false)}
                    onChange={(v) =>
                      updateField(id, { defaultValue: v === "true" })
                    }
                  >
                    <option value="false">{t("No")}</option>
                    <option value="true">{t("Sí")}</option>
                  </Choice>
                ) : field.type === "MultiSelect" ? (
                  <select
                    multiple
                    aria-label={t("Default choices")}
                    className="w-full rounded-md border p-2"
                    value={
                      Array.isArray(field.defaultValue)
                        ? field.defaultValue.map(String)
                        : []
                    }
                    onChange={(event) =>
                      updateField(id, {
                        defaultValue: Array.from(
                          event.currentTarget.selectedOptions,
                          (option) => option.value,
                        ),
                      })
                    }
                  >
                    {(field.options ?? []).map((option) => (
                      <option
                        key={String(option.value)}
                        value={String(option.value)}
                      >
                        {resolveOptionLabel(option, locale)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    type={
                      ["Number", "Currency", "Percentage", "Rating"].includes(
                        field.type,
                      )
                        ? "number"
                        : field.type === "DateTime" || config.dateTime === true
                          ? "datetime-local"
                          : field.type === "Time"
                            ? "time"
                            : field.type === "DateControl"
                              ? "date"
                              : "text"
                    }
                    value={
                      field.type === "DateTime" || config.dateTime === true
                        ? localDateTime(field.defaultValue)
                        : String(field.defaultValue ?? "")
                    }
                    onChange={(e) =>
                      updateField(id, {
                        defaultValue:
                          (field.type === "DateTime" ||
                            config.dateTime === true) &&
                          e.target.value
                            ? new Date(e.target.value).toISOString()
                            : parseValue(e.target.value, field.type),
                      })
                    }
                  />
                )}
              </Control>
            )}
        </PropertySection>
        {hasAdvancedConfig ? (
          <PropertySection
            title={t("Configuración del tipo")}
            searchTerms="validación patrón opciones mapa html archivos relación formato número"
          >
            {isR2Attachment && (
              <fieldset
                className="studio-rule"
                data-property-search={propertySearchTerms(
                  t("Archivos en R2"),
                  "adjunto attachment mime tamaño maximo",
                )}
              >
                <legend>{t("Archivos en R2")}</legend>
                <div className="studio-two">
                  <Control label={t("Máximo de archivos")}>
                    <Input
                      max={50}
                      min={1}
                      type="number"
                      value={String(config.maxFiles ?? 1)}
                      onChange={(event) =>
                        patch(
                          "maxFiles",
                          Math.max(
                            1,
                            Math.min(50, Number(event.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </Control>
                  <Control label={t("Tamaño máximo (MiB)")}>
                    <Input
                      max={5}
                      min={1}
                      step="0.1"
                      type="number"
                      value={String(
                        (Number(config.maxSize) || 5 * 1024 * 1024) /
                          (1024 * 1024),
                      )}
                      onChange={(event) =>
                        patch(
                          "maxSize",
                          Math.round(
                            Math.max(
                              1,
                              Math.min(5, Number(event.target.value) || 5),
                            ) *
                              1024 *
                              1024,
                          ),
                        )
                      }
                    />
                  </Control>
                </div>
                <Control
                  label={t("Tipos MIME permitidos")}
                  help={t(
                    "Déjalo vacío para aceptar cualquier tipo de archivo.",
                  )}
                >
                  <Input
                    placeholder="application/pdf, image/png"
                    value={
                      Array.isArray(config.accept)
                        ? config.accept.join(", ")
                        : ""
                    }
                    onChange={(event) =>
                      patch(
                        "accept",
                        event.target.value
                          .split(",")
                          .map((type) => type.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </Control>
              </fieldset>
            )}
            {field.type === FORM_HTML_TYPE ? (
              <fieldset
                className="studio-fieldset form-html-designer"
                data-property-search={propertySearchTerms(
                  t("HTML y JavaScript"),
                  "script editor formulario botón",
                )}
              >
                <legend className="studio-fieldset-legend-with-help">
                  {t("HTML y JavaScript")}
                  <StudioHelpTooltip label={t("Ayuda sobre HTML y JavaScript")}>
                    <>
                      <strong>{t("Solo para administradores.")}</strong>{" "}
                      {t(
                        "HTML y JavaScript personalizado pueden ejecutar lógica sensible, modificar valores del formulario y renderizar contenido no confiable. Úsalo únicamente con contenido de confianza.",
                      )}
                      <br />
                      <br />
                      {t("Botón sin script:")}{" "}
                      <code>
                        {
                          '<button type="button" data-savia-set-value="nombre" data-savia-value="Ejemplo">'
                        }
                      </code>
                      <br />
                      {t("Script avanzado:")}{" "}
                      <code>
                        getValue(name), setValue(name, value), container
                      </code>
                    </>
                  </StudioHelpTooltip>
                </legend>
                <div className="form-html-designer-actions">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setFormHtmlEditorOpen(true)}
                  >
                    {t("Abrir editor")}
                  </Button>
                </div>
                <Control label={t("Vista previa HTML")}>
                  <Textarea
                    className="form-html-designer-code form-html-designer-code--preview"
                    rows={4}
                    spellCheck={false}
                    readOnly
                    value={formHtml.html || t("Sin HTML configurado.")}
                  />
                </Control>
                <Control label={t("Vista previa JavaScript")}>
                  <Textarea
                    className="form-html-designer-code form-html-designer-code--preview"
                    rows={3}
                    spellCheck={false}
                    readOnly
                    value={formHtml.script?.trim() || t("Sin JavaScript.")}
                  />
                </Control>
                <FormHtmlEditorModal
                  open={formHtmlEditorOpen}
                  onOpenChange={setFormHtmlEditorOpen}
                  value={formHtml}
                  onSave={patchFormHtml}
                />
              </fieldset>
            ) : field.type === DISPLAY_TEXT_TYPE ? (
              <fieldset
                className="studio-fieldset display-text-designer"
                data-property-search={propertySearchTerms(
                  t("Texto fijo"),
                  "plantilla contenido heading display",
                )}
              >
                <legend className="studio-fieldset-legend-with-help">
                  {t("Texto fijo")}
                  <StudioHelpTooltip label={t("Plantillas disponibles")}>
                    <code>
                      {"{{values.campo}} · {{record.id}} · {{object.label}}"}
                    </code>
                  </StudioHelpTooltip>
                </legend>
                <Control label={t("Estilo")}>
                  <Choice
                    value={displayText.variant}
                    onChange={(value) =>
                      patchDisplayText({
                        variant: value as DisplayTextConfig["variant"],
                      })
                    }
                  >
                    {displayTextVariants.map((variant) => (
                      <option key={variant} value={variant}>
                        {displayTextVariantLabels[variant]}
                      </option>
                    ))}
                  </Choice>
                </Control>
                <Control label={t("Alineación")}>
                  <Choice
                    value={displayText.align ?? "left"}
                    onChange={(value) =>
                      patchDisplayText({
                        align:
                          value === "left"
                            ? undefined
                            : (value as NonNullable<
                                DisplayTextConfig["align"]
                              >),
                      })
                    }
                  >
                    <option value="left">{t("Izquierda")}</option>
                    <option value="center">{t("Centro")}</option>
                    <option value="right">{t("Derecha")}</option>
                  </Choice>
                </Control>
                <Control label={t("Contenido")}>
                  <Textarea
                    className="form-html-designer-code"
                    rows={5}
                    spellCheck={false}
                    value={displayText.content}
                    onChange={(event) =>
                      patchDisplayText({ content: event.target.value })
                    }
                    placeholder={t("Hola {{values.nombre}}")}
                  />
                </Control>
                <LocalizedContentEditor
                  maxLength={5000}
                  value={displayText.translations}
                  onChange={(translations) =>
                    patchDisplayText({ translations })
                  }
                />
              </fieldset>
            ) : field.type === "Percentage" ? (
              <>
                <div className="studio-two">
                  {numeric("minimum", t("Minimum percentage"))}
                  {numeric("maximum", t("Maximum percentage"))}
                </div>
                <Control label={t("Decimal places")}>
                  <Choice
                    value={String(config.decimals ?? 2)}
                    onChange={(value) => patch("decimals", Number(value))}
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Choice>
                </Control>
                <p className="text-sm text-muted-foreground">
                  {t("25 is stored as 25 and displayed as 25%.")}
                </p>
              </>
            ) : field.type === "Rating" ? (
              <>
                <Control label={t("Maximum rating")}>
                  <Choice
                    value={String(config.maximum ?? 5)}
                    onChange={(value) => patch("maximum", Number(value))}
                  >
                    {Array.from({ length: 10 }, (_, index) => index + 1).map(
                      (value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ),
                    )}
                  </Choice>
                </Control>
                <Control label={t("Rating display")}>
                  <Choice
                    value={String(config.ratingStyle ?? "stars")}
                    onChange={(value) => patch("ratingStyle", value)}
                  >
                    <option value="stars">{t("Stars")}</option>
                    <option value="number">{t("Number")}</option>
                  </Choice>
                </Control>
              </>
            ) : field.type === "Number" || field.type === "Currency" ? (
              <>
                <div className="studio-two">
                  {numeric("minimum", t("Mínimo"))}
                  {numeric("maximum", t("Máximo"))}
                </div>
                {field.type === "Currency" ? (
                  <div className="studio-two">
                    <Control
                      label={t("Moneda")}
                      searchTerms="moneda divisa cop usd eur mxn currency dinero"
                    >
                      <Choice
                        value={String(config.currency ?? "COP")}
                        onChange={(v) => patch("currency", v)}
                      >
                        <option value="COP">COP ($)</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="MXN">MXN ($)</option>
                      </Choice>
                    </Control>
                    <Control
                      label={t("Decimales")}
                      searchTerms="decimales decimal precisión precision centavos"
                    >
                      <Choice
                        value={String(
                          typeof config.decimals === "number"
                            ? config.decimals
                            : config.integer
                              ? "0"
                              : "2",
                        )}
                        onChange={(v) => {
                          const dec = Number(v);
                          patchConfig({ decimals: dec, integer: dec === 0 });
                        }}
                      >
                        <option value="2">{t("2 decimales (.00)")}</option>
                        <option value="0">{t("0 decimales (enteros)")}</option>
                        <option value="1">{t("1 decimal (.0)")}</option>
                        <option value="3">{t("3 decimales (.000)")}</option>
                        <option value="4">{t("4 decimales (.0000)")}</option>
                      </Choice>
                    </Control>
                  </div>
                ) : (
                  <Flag
                    label={t("Solo enteros")}
                    searchTerms="integer entero decimal"
                    value={config.integer}
                    onChange={(v) => patch("integer", v)}
                  />
                )}
              </>
            ) : field.type === "MapLocation" && mapPicker ? (
              <>
                <Flag
                  label={t("Detectar ubicación del usuario")}
                  value={mapPicker.geolocation !== false}
                  onChange={(enabled) =>
                    patchMapPicker({ geolocation: enabled })
                  }
                />
                <Flag
                  label={t("Obtener dirección al seleccionar")}
                  value={mapPicker.reverseGeocode !== false}
                  onChange={(enabled) =>
                    patchMapPicker({ reverseGeocode: enabled })
                  }
                />
                <Control label={t("Zoom inicial")}>
                  <Input
                    type="number"
                    min={3}
                    max={18}
                    value={String(mapPicker.zoom ?? 14)}
                    onChange={(event) => {
                      const zoom = Number(event.target.value);
                      patchMapPicker({
                        zoom: Number.isFinite(zoom) ? zoom : 14,
                      });
                    }}
                  />
                </Control>
                <fieldset
                  className="studio-fieldset"
                  data-property-search={propertySearchTerms(
                    t("Punto de referencia"),
                    "mapa latitud longitud centro zoom",
                  )}
                >
                  <legend className="studio-fieldset-legend-with-help">
                    {t("Punto de referencia (opcional)")}
                    <StudioHelpTooltip
                      label={t("Punto de referencia del mapa")}
                    >
                      {t(
                        "Centra el mapa en un lugar fijo, por ejemplo un centro de ventas.",
                      )}
                    </StudioHelpTooltip>
                  </legend>
                  <Control label={t("Etiqueta")}>
                    <Input
                      value={String(mapPicker.reference?.label ?? "")}
                      placeholder={t("Centro de ventas Norte")}
                      onChange={(event) =>
                        patchMapPicker({
                          reference: {
                            ...(mapPicker.reference ?? defaultMapCenter),
                            label: event.target.value || undefined,
                          },
                        })
                      }
                    />
                  </Control>
                  <div className="studio-two">
                    <Control label={t("Latitud")}>
                      <Input
                        type="number"
                        step="any"
                        value={String(mapPicker.reference?.lat ?? "")}
                        placeholder="4.6097"
                        onChange={(event) => {
                          const lat = Number(event.target.value);
                          if (!Number.isFinite(lat)) return;
                          patchMapPicker({
                            reference: {
                              ...(mapPicker.reference ?? {
                                ...defaultMapCenter,
                                lng: -74.0817,
                              }),
                              lat,
                            },
                          });
                        }}
                      />
                    </Control>
                    <Control label={t("Longitud")}>
                      <Input
                        type="number"
                        step="any"
                        value={String(mapPicker.reference?.lng ?? "")}
                        placeholder="-74.0817"
                        onChange={(event) => {
                          const lng = Number(event.target.value);
                          if (!Number.isFinite(lng)) return;
                          patchMapPicker({
                            reference: {
                              ...(mapPicker.reference ?? {
                                ...defaultMapCenter,
                                lat: 4.6097,
                              }),
                              lng,
                            },
                          });
                        }}
                      />
                    </Control>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => patchMapPicker({ reference: undefined })}
                  >
                    {t("Quitar referencia")}
                  </Button>
                </fieldset>
                <Control
                  label={t("Proveedor de mapas")}
                  help={
                    <>
                      {t(
                        "Photon y Nominatim son gratuitos y no requieren clave. Geoapify requiere API key en",
                      )}{" "}
                      <a href={serviceCredentialsHref()}>
                        {t("Claves y servicios")}
                      </a>
                      .
                    </>
                  }
                >
                  <Choice
                    value={String(mapPicker.provider ?? "photon")}
                    onChange={(provider) =>
                      patchMapPicker({
                        provider: provider as MapPickerSettings["provider"],
                      })
                    }
                  >
                    <option value="photon">
                      {t("Photon (OpenStreetMap, gratis)")}
                    </option>
                    <option value="nominatim">
                      {t("Nominatim (OpenStreetMap, gratis)")}
                    </option>
                    <option value="geoapify">
                      {t("Geoapify (requiere API key)")}
                    </option>
                  </Choice>
                </Control>
                <Control label={t("País (opcional)")}>
                  <Input
                    value={String(mapPicker.country ?? "")}
                    placeholder="co"
                    maxLength={2}
                    onChange={(event) => {
                      const country = event.target.value.trim().toLowerCase();
                      patchMapPicker({ country: country || undefined });
                    }}
                  />
                </Control>
              </>
            ) : field.type === "Address" ? (
              <>
                <Flag
                  label={t("Autocompletar con mapas")}
                  value={!!config.addressAutocomplete}
                  onChange={(enabled) =>
                    patch(
                      "addressAutocomplete",
                      enabled
                        ? {
                            provider: "photon",
                            language: "es",
                            ...(typeof config.addressAutocomplete === "object"
                              ? config.addressAutocomplete
                              : {}),
                          }
                        : undefined,
                    )
                  }
                />
                {config.addressAutocomplete ? (
                  <>
                    <Control
                      label={t("Proveedor")}
                      help={
                        <>
                          {t(
                            "Photon y Nominatim son gratuitos y no requieren clave. Geoapify requiere API key en",
                          )}{" "}
                          <a href={serviceCredentialsHref()}>
                            {t("Claves y servicios")}
                          </a>
                          .
                        </>
                      }
                    >
                      <Choice
                        value={String(
                          addressAutocomplete?.provider ?? "photon",
                        )}
                        onChange={(provider) =>
                          patch("addressAutocomplete", {
                            ...(typeof config.addressAutocomplete === "object"
                              ? config.addressAutocomplete
                              : { language: "es" }),
                            provider,
                          })
                        }
                      >
                        <option value="photon">
                          {t("Photon (OpenStreetMap, gratis)")}
                        </option>
                        <option value="nominatim">
                          {t("Nominatim (OpenStreetMap, gratis)")}
                        </option>
                        <option value="geoapify">
                          {t("Geoapify (requiere API key)")}
                        </option>
                      </Choice>
                    </Control>
                    <Control label={t("País (opcional)")}>
                      <Input
                        value={String(addressAutocomplete?.country ?? "")}
                        placeholder="co"
                        maxLength={2}
                        onChange={(event) => {
                          const country = event.target.value
                            .trim()
                            .toLowerCase();
                          patch("addressAutocomplete", {
                            ...(typeof config.addressAutocomplete === "object"
                              ? config.addressAutocomplete
                              : { provider: "photon", language: "es" }),
                            country: country || undefined,
                          });
                        }}
                      />
                    </Control>
                  </>
                ) : null}
                <div className="studio-two">
                  {numeric("minLength", t("Largo mínimo"))}
                  {numeric("maxLength", t("Largo máximo"))}
                </div>
                <Control label={t("Patrón de validación")}>
                  <Input
                    value={String(config.pattern ?? "")}
                    placeholder={t("Expresión regular")}
                    onChange={(e) =>
                      patch("pattern", e.target.value || undefined)
                    }
                  />
                </Control>
              </>
            ) : ["Email", "Phone", "Url"].includes(field.type) ? (
              <>
                <div className="studio-two">
                  {numeric("minLength", t("Largo mínimo"))}
                  {numeric("maxLength", t("Largo máximo"))}
                </div>
                <Control label={t("Patrón de validación")}>
                  <Input
                    value={String(config.pattern ?? "")}
                    placeholder={t("Expresión regular")}
                    onChange={(e) =>
                      patch("pattern", e.target.value || undefined)
                    }
                  />
                </Control>
              </>
            ) : field.type === "RichText" ? (
              <div className="studio-two">
                {numeric("minLength", t("Minimum length"))}
                {numeric("maxLength", t("Maximum length"))}
              </div>
            ) : ["Textbox", "Textarea"].includes(field.type) ? (
              <>
                <Control label={t("Formato")}>
                  <Choice
                    value={String(config.format ?? "")}
                    onChange={(v) => patch("format", v || undefined)}
                  >
                    <option value="">{t("Texto libre")}</option>
                    <option value="email">{t("Correo")}</option>
                    <option value="url">URL</option>
                    <option value="phone">{t("Teléfono")}</option>
                  </Choice>
                </Control>
                <div className="studio-two">
                  {numeric("minLength", t("Largo mínimo"))}
                  {numeric("maxLength", t("Largo máximo"))}
                </div>
                <Control label={t("Patrón de validación")}>
                  <Input
                    value={String(config.pattern ?? "")}
                    placeholder={t("Expresión regular")}
                    onChange={(e) =>
                      patch("pattern", e.target.value || undefined)
                    }
                  />
                </Control>
              </>
            ) : null}
            {field.type === "Dropdown" && (
              <>
                <Control label={t("Relacionar con")}>
                  <Choice
                    value={String(config.relation ?? "")}
                    onChange={(v) =>
                      updateField(id, {
                        defaultValue: undefined,
                        config: {
                          ...config,
                          relation: v || undefined,
                          optionsWhen: undefined,
                          multiple: false,
                          onDelete: v ? "restrict" : undefined,
                        },
                      })
                    }
                  >
                    <option value="">{t("Opciones de selección")}</option>
                    {objects.data?.data.map((o: StudioObject) => (
                      <option key={o.name} value={o.name}>
                        {o.label}
                      </option>
                    ))}
                  </Choice>
                </Control>
                {objects.error && <p role="alert">{objects.error.message}</p>}
                {config.relation ? (
                  <>
                    <Flag
                      label={t("Permitir varios registros")}
                      value={config.multiple}
                      onChange={(v) => patch("multiple", v)}
                    />
                    <Control label={t("Al eliminar un registro relacionado")}>
                      <Choice
                        value={String(config.onDelete ?? "restrict")}
                        onChange={(v) => patch("onDelete", v)}
                      >
                        <option value="restrict">
                          {t("Impedir eliminación")}
                        </option>
                        <option value="clear">
                          {t("Quitar la referencia")}
                        </option>
                      </Choice>
                    </Control>
                  </>
                ) : (
                  <>
                    <Control
                      label={t("Opciones (valor | etiqueta, una por línea)")}
                    >
                      <Textarea
                        value={
                          field.options
                            ?.map((o) => `${o.value} | ${o.label}`)
                            .join("\n") ?? ""
                        }
                        onChange={(e) =>
                          updateField(id, {
                            options: parseStaticOptions(
                              e.target.value,
                              field.options ?? [],
                            ),
                          })
                        }
                      />
                    </Control>
                    <StaticOptionLabelsEditor
                      options={field.options ?? []}
                      onChange={(options) => updateField(id, { options })}
                    />
                  </>
                )}
                {!config.relation && (
                  <DependentOptionsEditor
                    name={id}
                    fields={state.fields}
                    value={config.optionsWhen as any}
                    onChange={(v) => patch("optionsWhen", v)}
                  />
                )}
              </>
            )}
            {(field.type === "Autocomplete" ||
              field.type === "MultiSelect") && (
              <>
                <>
                  <Control
                    label={t("Opciones (valor | etiqueta, una por línea)")}
                  >
                    <Textarea
                      value={
                        field.options
                          ?.map((o) => `${o.value} | ${o.label}`)
                          .join("\n") ?? ""
                      }
                      onChange={(e) =>
                        updateField(id, {
                          options: parseStaticOptions(
                            e.target.value,
                            field.options ?? [],
                          ),
                        })
                      }
                    />
                  </Control>
                  <StaticOptionLabelsEditor
                    options={field.options ?? []}
                    onChange={(options) => updateField(id, { options })}
                  />
                </>
                {field.type !== "MultiSelect" && (
                  <DependentOptionsEditor
                    name={id}
                    fields={state.fields}
                    value={config.optionsWhen as any}
                    onChange={(v) => patch("optionsWhen", v)}
                  />
                )}
              </>
            )}
          </PropertySection>
        ) : null}
        <PropertySection
          title={t("Distribución")}
          searchTerms="sección ancho paso wizard layout columna"
        >
          {studio.wizard?.enabled && (
            <Control label={t("Paso del wizard")}>
              <Choice
                value={String(config.step ?? "")}
                onChange={(value) => patch("step", value || undefined)}
              >
                <option value="">{t("Seleccionar paso")}</option>
                {studio.wizard.steps.map((step, index) => (
                  <option key={step.id} value={step.id}>
                    {index + 1}. {step.title}
                  </option>
                ))}
              </Choice>
            </Control>
          )}
          <Control label={t("Sección")}>
            <Choice
              value={String(config.section ?? "")}
              onChange={(v) => patch("section", v || undefined)}
            >
              <option value="">{t("General")}</option>
              {studio.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Choice>
          </Control>
          <Control label={t("Ancho")}>
            <Choice
              value={String(config.width ?? 1)}
              onChange={(v) => patch("width", Number(v))}
            >
              <option value="1">{t("Una columna")}</option>
              <option value="2">{t("Ancho completo")}</option>
            </Choice>
          </Control>
        </PropertySection>
        <PropertySection
          title={t("Condiciones")}
          searchTerms="reglas mostrar obligatorio visible required when"
        >
          <RuleEditor
            label={t("Mostrar cuando")}
            value={config.visibleWhen as Condition | undefined}
            onChange={(v) => patch("visibleWhen", v)}
            fields={state.fields}
            excludeField={id}
          />
          <RuleEditor
            label={t("Obligatorio cuando")}
            value={config.requiredWhen as Condition | undefined}
            onChange={(v) => patch("requiredWhen", v)}
            fields={state.fields}
            excludeField={id}
          />
        </PropertySection>
        {field.type === "Number" ? (
          <PropertySection
            title={t("Cálculo automático")}
            searchTerms="formula operación suma resta producto división"
          >
            <Control
              label={t("Operación")}
              help={t(
                "Selecciona los operandos numéricos en el orden deseado.",
              )}
            >
              <Choice
                value={(config.formula as any)?.op ?? ""}
                onChange={(op) =>
                  patch("formula", op ? { op, fields: [] } : undefined)
                }
              >
                <option value="">{t("Sin cálculo")}</option>
                <option value="sum">{t("Suma")}</option>
                <option value="difference">{t("Resta (en orden)")}</option>
                <option value="product">{t("Producto")}</option>
                <option value="ratio">{t("División (en orden)")}</option>
              </Choice>
            </Control>
            {!!config.formula && (
              <>
                {Object.entries(state.fields)
                  .filter(([name, f]) => name !== id && f.type === "Number")
                  .map(([name, f]) => (
                    <Flag
                      key={name}
                      label={f.label}
                      value={(config.formula as any).fields.includes(name)}
                      onChange={(checked) => {
                        const formula = config.formula as any;
                        patch("formula", {
                          ...formula,
                          fields: checked
                            ? [...formula.fields, name]
                            : formula.fields.filter((v: string) => v !== name),
                        });
                      }}
                    />
                  ))}
                <p>
                  {(config.formula as any).fields
                    .map((name: string) => state.fields[name]?.label ?? name)
                    .join(" → ")}
                </p>
              </>
            )}
          </PropertySection>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-property-search={propertySearchTerms(
            t("Quitar campo"),
            "eliminar borrar delete",
          )}
          onClick={() => removeField(id)}
        >
          <Trash2 size={14} /> {t("Quitar campo")}
        </Button>
      </div>
    </aside>
  );
}

function Editor({
  object,
  onSaved,
}: {
  object: StudioObject;
  onSaved: () => void;
}) {
  const t = useMessages(studioMessages);
  const locale = useAppLocale();
  const { state, addField, updateField, undo, redo } = useDesigner();
  const [studio, setStudio] = useState<Studio>({
    columns: 1,
    sections: [],
    ...(object.config as any).studio,
  });
  const [mode, setMode] = useState<EditorMode>("design");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [impact, setImpact] = useState<any>();
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [drop, setDrop] = useState<string[]>([]);
  const [newFieldId, setNewFieldId] = useState("");
  const [paletteSearch, setPaletteSearch] = useState("");
  const versions = useQuery({
    queryKey: ["object-versions", object.name, object.version],
    queryFn: () => api(`/objects/${object.name}/versions`),
    enabled: mode === "versions",
  });
  const config = useMemo(
    () => ({
      ...object.config,
      version: 2 as const,
      fields: state.fields,
      fieldOrder: state.fieldOrder,
      settings: state.settings,
      studio,
    }),
    [object.config, state.fields, state.fieldOrder, state.settings, studio],
  );
  const draft = useMemo(() => ({ ...object, config }), [object, config]);
  const migration = {
    rename: Object.fromEntries(Object.entries(renames).filter(([, v]) => v)),
    drop,
  };
  const removed = Object.keys(object.config.fields).filter(
    (n) => !state.fields[n],
  );
  const candidateKey = JSON.stringify({ draft, migration });
  const checked = impact?.key === candidateKey ? impact.result : null;
  const palette = getLocalizedFieldTypePalette(locale);
  const filteredPalette = useMemo(
    () => filterPaletteFieldTypes(palette, paletteSearch),
    [paletteSearch, locale],
  );
  function addPaletteType(type: string) {
    const resolved = resolvePaletteFieldId(
      newFieldId,
      state.fields,
      () => nextId(type),
      { strictCustom: true },
    );
    if (resolved.abort) {
      setError(
        resolved.error ? t(resolved.error as keyof typeof studioMessages) : "",
      );
      return;
    }
    addField(resolved.id, paletteFieldDefinition(type));
    setNewFieldId("");
    setError("");
  }
  function nextId(type: string) {
    let i = 1;
    while (state.fields[`${type.toLowerCase()}_${i}`]) i++;
    return `${type.toLowerCase()}_${i}`;
  }
  function sampleFieldId() {
    const match = Object.entries(state.fields).find(
      ([name, field]) => name !== "__palette_new__" && field.type === "Textbox",
    );
    return match?.[0] ?? "campo_1";
  }
  function paletteFieldDefinition(type: string, sectionId?: string) {
    const config: Record<string, unknown> = {};
    if (sectionId) config.section = sectionId;
    if (studio.wizard?.enabled && studio.wizard.steps[0]?.id) {
      config.step = studio.wizard.steps[0].id;
    }
    if (type === "MapLocation") {
      config.mapPicker = {
        geolocation: true,
        reverseGeocode: true,
        zoom: 14,
        language: "es",
        provider: "photon",
      };
    }
    if (type === FORM_HTML_TYPE) {
      const sampleField = sampleFieldId();
      config.formHtml = {
        html: `<div class="form-html-block"><p>{{values.${sampleField}}}</p><button type="button" class="btn" data-savia-set-value="${sampleField}" data-savia-value="Ejemplo">Usar ejemplo</button></div>`,
        script: "",
      };
    }
    if (type === DISPLAY_TEXT_TYPE) {
      const sampleField = sampleFieldId();
      config.displayText = {
        variant: "title",
        content: `{{values.${sampleField}}}`,
      };
    }
    if (type === "Percentage") {
      config.minimum = 0;
      config.maximum = 100;
      config.decimals = 2;
    }
    if (type === "Rating") {
      config.maximum = 5;
      config.ratingStyle = "stars";
    }
    if (type === "Currency") {
      config.currency = "COP";
      config.decimals = 2;
    }
    return {
      type,
      label: fieldTypeLabel(type, locale),
      ...(type === FORM_HTML_TYPE || type === DISPLAY_TEXT_TYPE
        ? { readOnly: true, required: false }
        : {}),
      ...(Object.keys(config).length ? { config } : {}),
      ...(type === "Dropdown" ||
      type === "Autocomplete" ||
      type === "MultiSelect"
        ? { options: [{ value: "opcion_1", label: t("Opción 1") }] }
        : {}),
    };
  }
  function addPaletteField(
    type: string,
    sectionId = "",
    beforeFieldId?: string,
  ) {
    const resolved = resolvePaletteFieldId(newFieldId, state.fields, () =>
      nextId(type),
    );
    if (resolved.error)
      setError(t(resolved.error as keyof typeof studioMessages));
    else setError("");

    const sectionIds = new Set(studio.sections.map((section) => section.id));
    const position = buildGroupedFieldOrder(
      state.fieldOrder,
      state.fields,
      "__palette_new__",
      sectionId,
      sectionIds,
      beforeFieldId,
    ).indexOf("__palette_new__");
    addField(
      resolved.id,
      paletteFieldDefinition(type, sectionId || undefined),
      position,
    );
    setNewFieldId("");
  }
  function canvasCopy(e: React.MouseEvent<HTMLDivElement>) {
    const button = (e.target as HTMLElement).closest(
      'button[title="Duplicate field"]',
    );
    if (!button) return;
    const card = button.closest(
        "[data-field-id], .grouped-designer-field-card",
      ),
      canvas = button.closest(".dfd-canvas");
    if (!card || !canvas) return;
    e.stopPropagation();
    const index = Array.from(
      canvas.querySelectorAll("[data-field-id]"),
    ).indexOf(card);
    const field = state.fields[state.fieldOrder[index]];
    addField(
      nextId(field.type),
      {
        ...structuredClone(field),
        label: t("%{v1} (copia)", { v1: field.label }),
        labels: field.labels ? structuredClone(field.labels) : undefined,
      },
      index + 1,
    );
  }
  function validateActions() {
    if (!studio.requestPage) return;
    const parsed = requestPageSchema.safeParse(studio.requestPage);
    if (!parsed.success)
      throw new Error(
        t("Revisa Eventos y acciones:") +
          parsed.error.issues.map((issue) => issue.message).join(" "),
      );
    for (const action of parsed.data.actions) {
      for (const field of [
        ...Object.values(action.input),
        ...Object.keys(action.output),
      ]) {
        if (!state.fields[field])
          throw new Error(
            t(
              "La acción «%{v1}» referencia el campo eliminado «%{v2}». Corrige sus asignaciones.",
              { v1: action.label, v2: field },
            ),
          );
      }
    }
  }
  async function inspect() {
    setError("");
    setBusy(true);
    try {
      validateActions();
      const result = await api(`/objects/${object.name}/preview`, "POST", {
        object: draft,
        migration,
      });
      setImpact({ key: candidateKey, result: result.data });
      return result.data;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setError("");
    setBusy(true);
    try {
      validateActions();
      const result = await api(`/objects/${object.name}/preview`, "POST", {
        object: draft,
        migration,
      });
      setImpact({ key: candidateKey, result: result.data });
      if (!result.data.valid) {
        setError(
          t("La configuración necesita correcciones antes de publicarse."),
        );
        return;
      }
      await api(`/objects/${object.name}`, "PUT", {
        ...draft,
        version: object.version ?? 1,
        migration,
      });
      toast.success(t("Formulario publicado"));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={
        mode === "settings"
          ? "studio-designer studio-designer--settings"
          : "studio-designer"
      }
    >
      <div className="designer-toolbar">
        <div className="designer-toolbar-history">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t("Deshacer")}
            title={t("Deshacer")}
            onClick={undo}
            disabled={!state.undoStack.length}
          >
            <Undo2 size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t("Rehacer")}
            title={t("Rehacer")}
            onClick={redo}
            disabled={!state.redoStack.length}
          >
            <Redo2 size={14} aria-hidden="true" />
          </Button>
        </div>
        <nav
          className="designer-toolbar-views"
          aria-label={t("Vista del diseñador")}
        >
          {editorViews.map((view) => (
            <button
              key={view.id}
              type="button"
              className={
                mode === view.id
                  ? "designer-toolbar-view designer-toolbar-view--active"
                  : "designer-toolbar-view"
              }
              aria-current={mode === view.id ? "page" : undefined}
              onClick={() => setMode(view.id)}
            >
              {view.icon}
              {t(view.label as keyof typeof studioMessages)}
            </button>
          ))}
        </nav>
        <div className="designer-toolbar-actions">
          <p className="designer-toolbar-meta">
            {state.fieldOrder.length} {t("campos · v")} {object.version ?? 1}
          </p>
          <Button
            type="button"
            size="sm"
            className="designer-toolbar-publish"
            disabled={busy}
            aria-label={t("Publicar formulario")}
            title={t("Publicar formulario")}
            onClick={publish}
          >
            <Save size={14} aria-hidden="true" />
            {busy ? t("Publicando…") : t("Publicar")}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {mode === "settings" && (
        <WizardDesigner
          studio={studio}
          setStudio={setStudio}
          pageName={object.name}
        />
      )}
      {mode === "design" && (
        <div className="studio-design-shell">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="studio-design-settings-fab size-9"
            aria-label={
              studio.requestPage
                ? studio.wizard?.enabled
                  ? t("Ajustes: pasos, columnas, secciones y resultados")
                  : t("Ajustes: columnas, secciones y resultados")
                : studio.wizard?.enabled
                  ? t("Ajustes: pasos, columnas y secciones del formulario")
                  : t("Ajustes: columnas y secciones del formulario")
            }
            title={
              studio.requestPage
                ? studio.wizard?.enabled
                  ? t("Pasos, columnas, secciones y resultados")
                  : t("Columnas, secciones y resultados")
                : studio.wizard?.enabled
                  ? t("Pasos, columnas y secciones")
                  : t("Columnas y secciones")
            }
            onClick={() => setMode("settings")}
          >
            <Cog size={16} aria-hidden="true" />
          </Button>
          <div className="dfd-root crm-designer" onClickCapture={canvasCopy}>
            <div className="dfd-body">
              <div className="dfd-palette">
                <h3 className="dfd-palette-title">{t("Agregar campo")}</h3>
                <PaletteTypeSearch
                  query={paletteSearch}
                  onQueryChange={setPaletteSearch}
                />
                <details className="palette-new-field-id">
                  <summary className="palette-new-field-id-summary">
                    <span>{t("Identificador")}</span>
                    <StudioHelpTooltip label={t("Identificador al agregar")}>
                      {t(
                        "Opcional. Déjalo vacío para generar uno automático al agregar el campo.",
                      )}
                    </StudioHelpTooltip>
                  </summary>
                  <Control
                    label={t("Identificador personalizado")}
                    help={t("Vacío = automático. Minúsculas, números y _.")}
                  >
                    <Input
                      value={newFieldId}
                      placeholder="mi_campo"
                      onChange={(e) => {
                        setNewFieldId(e.target.value);
                        if (error) setError("");
                      }}
                    />
                  </Control>
                </details>
                {!filteredPalette.length ? (
                  <p className="palette-type-search-empty" role="status">
                    {t("Sin tipos coincidentes para «")}
                    {paletteSearch.trim()}».
                  </p>
                ) : null}
                {filteredPalette.map(({ type, label, icon: Icon }) => (
                  <button
                    className="palette-field"
                    key={type}
                    type="button"
                    data-palette-type={type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(designerPaletteDragType, type);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => addPaletteType(type)}
                  >
                    <span className="palette-field-icon" aria-hidden="true">
                      <Icon size={15} />
                    </span>
                    {label}
                  </button>
                ))}
              </div>
              <GroupedDesignerCanvas
                sections={studio.sections}
                requestPage={studio.requestPage}
                onPaletteDrop={addPaletteField}
              />
              <Properties
                objectName={object.name}
                studio={studio}
                setStudio={setStudio}
              />
            </div>
          </div>
        </div>
      )}
      {mode === "preview" && (
        <section className="studio-live-preview studio-form-preview">
          <p className="studio-preview-lede">
            {t("Vista previa en simulación. Validar no crea registros.")}
          </p>
          <div className="request-capture">
            <DynamicForm
              key={candidateKey}
              object={draft}
              onSave={async () => {
                toast.success(t("Datos válidos para este formulario"));
              }}
              submitLabel={t("Validar ejemplo")}
              renderFieldActions={(field) => {
                const actions =
                  studio.requestPage?.actions.filter(
                    (a) =>
                      a.kind === "lookup" &&
                      Object.values(a.input)[0] === field,
                  ) ?? [];
                if (!actions.length) return null;
                return (
                  <LookupActions
                    fieldName={field}
                    actions={actions}
                    execute={(action, data) =>
                      executeRequestPageAction(
                        object.name,
                        action,
                        data,
                        "mock",
                      )
                    }
                  />
                );
              }}
            />
          </div>
        </section>
      )}
      {mode === "json" && (
        <section
          className="min-w-0 space-y-3"
          aria-label={t("Configuración JSON")}
        >
          <p className="text-sm text-muted-foreground">
            {t(
              "Configuración del borrador · Solo lectura. Usa los ajustes del diseñador para modificarla.",
            )}
          </p>
          <MonacoCodeEditor
            language="json"
            ariaLabel="JSON de la pantalla"
            value={JSON.stringify(config, null, 2)}
            onChange={() => {}}
            readOnly
            height={600}
          />
        </section>
      )}
      {mode === "versions" && (
        <section className="studio-versions">
          <h3>{t("Historial de configuración")}</h3>
          {versions.isPending && <p>{t("Cargando versiones…")}</p>}
          {versions.error && <p role="alert">{versions.error.message}</p>}
          {versions.data?.data.map((v: any) => (
            <article key={v.version}>
              <div>
                <strong>
                  {t("Versión")} {v.version} · {v.label}
                </strong>
                <p>
                  {new Date(v.created_at).toLocaleString(intlLocale(locale))} ·{" "}
                  {Object.keys(v.config.fields).length} {t("campos")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || v.version === (object.version ?? 1)}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api(`/objects/${object.name}/restore`, "POST", {
                      targetVersion: v.version,
                      version: object.version ?? 1,
                    });
                    toast.success(
                      t("Configuración restaurada como nueva versión"),
                    );
                    onSaved();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("Restaurar")}
              </Button>
            </article>
          ))}
        </section>
      )}
      {mode !== "preview" && mode !== "settings" && (
        <section className="studio-impact">
          <h3>{t("Impacto en los registros")}</h3>
          {removed.length > 0 && (
            <>
              <p>
                {t(
                  "Indica dónde conservar los datos de los campos quitados o marca su eliminación.",
                )}
              </p>
              {removed.map((old) => (
                <div className="studio-migration" key={old}>
                  <code>{old}</code>
                  <Choice
                    label={t("Migrar %{v1} a", { v1: old })}
                    value={renames[old] ?? ""}
                    onChange={(v) => {
                      setRenames({ ...renames, [old]: v });
                      setDrop(drop.filter((n) => n !== old));
                    }}
                  >
                    <option value="">{t("Seleccionar destino")}</option>
                    {state.fieldOrder.map((n) => (
                      <option key={n} value={n}>
                        {state.fields[n].label} ({n})
                      </option>
                    ))}
                  </Choice>
                  <Flag
                    label={t("Eliminar sus datos")}
                    value={drop.includes(old)}
                    onChange={(v) => {
                      setDrop(
                        v ? [...drop, old] : drop.filter((n) => n !== old),
                      );
                      setRenames({ ...renames, [old]: "" });
                    }}
                  />
                </div>
              ))}
            </>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={inspect}>
            {t("Revisar impacto")}
          </Button>
          {checked && (
            <div aria-live="polite">
              <p>
                {checked.valid
                  ? t("Configuración válida")
                  : t("Se encontraron incompatibilidades")}{" "}
                · {checked.changed} {t("registros cambiarán")}
              </p>
              {checked.errors?.map((e: any, index: number) => (
                <p role="alert" key={index}>
                  {e.id}: {e.error}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
export default function Designer({
  object,
  onSaved,
}: {
  object: StudioObject;
  onSaved: () => void;
}) {
  const capabilities = collectionCapabilities(object);
  if (!capabilities.schema && !capabilities.customFields)
    return (
      <CollectionLayoutDesigner
        key={`${object.name}-${object.version}`}
        object={object}
        onSaved={onSaved}
      />
    );
  return (
    <DesignerProvider
      key={`${object.name}-${object.version ?? 1}`}
      initialState={{
        ...createInitialDesignerState(),
        fields: object.config.fields,
        fieldOrder:
          object.config.fieldOrder ?? Object.keys(object.config.fields),
        settings: object.config.settings ?? {},
      }}
    >
      <Editor object={object} onSaved={onSaved} />
    </DesignerProvider>
  );
}
