import { resolveFieldLabel } from "@savia/studio-shared/field-labels";
import { intlLocale, useAppLocale } from "@/i18n/core";
import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { FieldValueDisplay } from "./field-value-display";
import RecordHistorySettingsButton from "./record-history-settings";
import { useDebouncedSearch } from "./use-debounced-search";
import { RetainedListResults } from "./retained-list-results";
import { RecordOriginLinks } from "./record-origin-links";
import {
  collectionCapabilities,
  supportsLocalRecordTools,
} from "./collection-capabilities";
import React, { lazy, Suspense, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListBase, useListContext, useRecordContext } from "ra-core";
import { BulkActionsToolbar } from "@/components/admin/bulk-actions-toolbar";
import { DataTable } from "@/components/admin/data-table";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { Confirm } from "@/components/admin/confirm";
import { ListPagination } from "@/components/admin/list-pagination";
import { SelectAllButton } from "@/components/admin/select-all-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  ArchiveRestore,
  Search,
  Plus,
  SlidersHorizontal,
  Trash2,
  Save,
  Table2,
  Columns3,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  X,
} from "lucide-react";
import { api, downloadCrm } from "./api";
import { getListObjectsQueryKey } from "./generated/crm";
import { getStudioRuntime } from "./runtime";
import { useRealtimeTopics } from "@/realtime/use-realtime";
import {
  fieldEntries,
  getPipeline,
  R2_ATTACHMENT_TYPE,
  type StudioObject,
  type StudioRecord,
} from "@savia/studio-shared/metadata";
import {
  formatMapLocationSummary,
  parseMapLocation,
} from "@savia/studio-shared/map-location";
import { recordsCsvFilename } from "@savia/studio-shared/records-csv-export";
import { getScrollParent, syncScrollButtonPosition } from "./table-scroll";
import "./records.css";
import { RecordsCommandToolbar } from "./records-command-toolbar";
type Condition = { field: string; op: string; value?: unknown };
type Settings = {
  q: string;
  searchField: string;
  stage: string;
  filters: { logic: "and" | "or"; conditions: Condition[] };
  columns: string[];
  columnOrder: string[];
  columnAliases: Record<string, string>;
  sort: { field: string; order: "ASC" | "DESC" };
  group: string;
  mode: "table" | "pipeline";
  perPage: number;
};
type TablePreferences = Pick<
  Settings,
  "columns" | "columnOrder" | "columnAliases"
>;
type ConfigTab = "table" | "form";
type SavedView = { id: string; name: string; config: Partial<Settings> };
export const CRM_INTEGRATION_COLUMN_KEY = "__crm_integration";
const CRM_INTEGRATION_COLUMN_LABEL = "CRM";
const EMPTY_RECORDS: StudioRecord[] = [];
function hasCrmIntegrationColumn(object: StudioObject) {
  const collection = object.config.studio?.collection;
  return (
    collection?.kind === "crm" ||
    collection?.sourceId === "hubspot" ||
    object.name.toLowerCase().includes("hubspot") ||
    object.config.studio?.business === "managed-customer"
  );
}
function recordLabel(record: StudioRecord) {
  for (const key of ["name", "displayName", "title", "subject"]) {
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim())
      return String(value);
  }
  return String(record.id);
}
const display = (v: unknown, locale = "es-CO") => {
  const location = parseMapLocation(v);
  if (location) return formatMapLocationSummary(location);
  return v === null || v === undefined || v === ""
    ? "—"
    : typeof v === "boolean"
      ? v
        ? locale.startsWith("en")
          ? "Yes"
          : locale.startsWith("pt")
            ? "Sim"
            : "Sí"
        : locale.startsWith("pt")
          ? "Não"
          : "No"
      : Array.isArray(v)
        ? v.join(", ")
        : String(v);
};
function displayCustomerEmail(value: unknown) {
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        Array.isArray(parsed) &&
        parsed.every((entry) => typeof entry === "string")
      )
        return parsed.join(", ");
    } catch {
      /* Preserve the source value if it is not JSON. */
    }
  }
  return display(value);
}
const money = (
  v: unknown,
  currency = "COP",
  decimals = 2,
  locale = "es-CO",
) => {
  const code = currency || "COP";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(v) || 0);
  } catch {
    return String(v ?? "");
  }
};

const FormColumnPicker = lazy(() =>
  import("./form-layout-picker").then((module) => ({
    default: module.FormColumnPicker,
  })),
);
const FormLabelsEditor = lazy(() =>
  import("./form-labels-editor").then((module) => ({
    default: module.FormLabelsEditor,
  })),
);
const CollectionOptionsEditor = lazy(() =>
  import("./collection-options-editor").then((module) => ({
    default: module.CollectionOptionsEditor,
  })),
);

type HorizontalScrollState = {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

function useHorizontalTableScroll(columns: string[], dataLength: number) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<HorizontalScrollState>({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });
  const signature = `${columns.join("|")}:${dataLength}`;

  useEffect(() => {
    const shell = shellRef.current;
    const viewport = shell?.querySelector(
      '[data-slot="table-container"]',
    ) as HTMLDivElement | null;
    if (!viewport) return;

    let rafId: number | null = null;
    const scrollContainer = getScrollParent(shell);

    const syncHorizontal = () => {
      const maxScrollLeft = Math.max(
        0,
        viewport.scrollWidth - viewport.clientWidth,
      );
      const hasOverflow = maxScrollLeft > 1;
      setState({
        hasOverflow,
        canScrollLeft: hasOverflow && viewport.scrollLeft > 1,
        canScrollRight: hasOverflow && viewport.scrollLeft < maxScrollLeft - 1,
      });
    };

    const syncVertical = () => {
      syncScrollButtonPosition(shell);
    };

    const onVerticalScroll = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncVertical);
    };

    const syncAll = () => {
      syncHorizontal();
      syncVertical();
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(syncAll);

    syncAll();
    viewport.addEventListener("scroll", syncHorizontal, { passive: true });
    window.addEventListener("resize", syncAll);
    window.addEventListener("scroll", onVerticalScroll, { passive: true });
    scrollContainer?.addEventListener("scroll", onVerticalScroll, {
      passive: true,
    });
    resizeObserver?.observe(viewport);
    if (shell) resizeObserver?.observe(shell);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      viewport.removeEventListener("scroll", syncHorizontal);
      window.removeEventListener("resize", syncAll);
      window.removeEventListener("scroll", onVerticalScroll);
      scrollContainer?.removeEventListener("scroll", onVerticalScroll);
      resizeObserver?.disconnect();
    };
  }, [signature]);

  function scrollByPage(direction: "left" | "right") {
    const viewport = shellRef.current?.querySelector(
      '[data-slot="table-container"]',
    ) as HTMLDivElement | null;
    if (!viewport) return;
    const amount = Math.max(240, Math.floor(viewport.clientWidth * 0.8));
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    viewport.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  return { ...state, scrollByPage, shellRef };
}

function params(s: Settings, trash = false) {
  return {
    q: s.q,
    ...(s.searchField ? { searchField: s.searchField } : {}),
    stage: s.stage,
    filters: JSON.stringify(s.filters),
    trash: String(trash),
  };
}
function orderColumns(order: string[], available: string[]) {
  const availableSet = new Set(available);
  return [
    ...order.filter((key) => availableSet.has(key)),
    ...available.filter((key) => !order.includes(key)),
  ];
}
function moveColumn(order: string[], source: string, target: string) {
  if (source === target) return order;
  const next = order.filter((key) => key !== source);
  const targetIndex = next.indexOf(target);
  if (targetIndex === -1) return order;
  next.splice(targetIndex, 0, source);
  return next;
}
function tablePreferences(settings: Settings): TablePreferences {
  return {
    columns: [...settings.columns],
    columnOrder: [...settings.columnOrder],
    columnAliases: { ...settings.columnAliases },
  };
}
function normalizeTablePreferences(
  preferences: Partial<TablePreferences> | undefined,
  defaults: Settings,
  available: string[],
): TablePreferences {
  const availableSet = new Set(available);
  const hasCrmColumn = availableSet.has(CRM_INTEGRATION_COLUMN_KEY);
  const hasExplicitCrmVisibility =
    preferences?.columns?.includes(CRM_INTEGRATION_COLUMN_KEY) === true ||
    preferences?.columnOrder?.includes(CRM_INTEGRATION_COLUMN_KEY) === true;
  const columns = (preferences?.columns ?? defaults.columns).filter((key) =>
    availableSet.has(key),
  );
  const normalizedColumns =
    hasCrmColumn && !hasExplicitCrmVisibility
      ? [
          CRM_INTEGRATION_COLUMN_KEY,
          ...columns.filter((key) => key !== CRM_INTEGRATION_COLUMN_KEY),
        ]
      : columns;
  const orderedColumns = orderColumns(
    preferences?.columnOrder ?? preferences?.columns ?? defaults.columnOrder,
    available,
  );
  return {
    columns: hasCrmColumn
      ? [
          ...(normalizedColumns.includes(CRM_INTEGRATION_COLUMN_KEY)
            ? [CRM_INTEGRATION_COLUMN_KEY]
            : []),
          ...normalizedColumns.filter(
            (key) => key !== CRM_INTEGRATION_COLUMN_KEY,
          ),
        ]
      : normalizedColumns,
    columnOrder: hasCrmColumn
      ? [
          CRM_INTEGRATION_COLUMN_KEY,
          ...orderedColumns.filter((key) => key !== CRM_INTEGRATION_COLUMN_KEY),
        ]
      : orderedColumns,
    columnAliases: Object.fromEntries(
      Object.entries(preferences?.columnAliases ?? {}).filter(([key]) =>
        availableSet.has(key),
      ),
    ),
  };
}
function hasSameTablePreferences(
  left: TablePreferences,
  right: TablePreferences,
) {
  const sameList = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  const leftAliases = Object.keys(left.columnAliases);
  const rightAliases = Object.keys(right.columnAliases);
  return (
    sameList(left.columns, right.columns) &&
    sameList(left.columnOrder, right.columnOrder) &&
    leftAliases.length === rightAliases.length &&
    leftAliases.every(
      (key) => left.columnAliases[key] === right.columnAliases[key],
    )
  );
}
function tenantIdFromDomainId(
  domainId: string | undefined,
): number | undefined {
  const match = /^tenant:([1-9]\d*)$/.exec(domainId ?? "");
  return match ? Number(match[1]) : undefined;
}

/**
 * Live sync for the records table. Subscribes to record hints for the
 * current tenant, debounces bursts (imports fire one event per row) into a
 * single refetch, and toasts what arrived. Renders nothing.
 */
function RecordsLiveSync({ objectName }: { objectName: string }) {
  const client = useQueryClient();
  const runtime = getStudioRuntime();
  const tenantId = tenantIdFromDomainId(runtime.domainId);
  useRealtimeTopics({
    topics: ["records"],
    tenantId,
    enabled: tenantId !== undefined,
    onEvent: (event) => {
      if (runtime.localWorkspace) {
        runtime.localWorkspace.requestSync();
        return;
      }
      if (event.collection && event.collection !== objectName) return;
      void client.invalidateQueries({ queryKey: [objectName] });
      void client.invalidateQueries({ queryKey: ["summary", objectName] });
    },
  });
  return null;
}

export default function Records({
  object,
  onOpen,
  initialConfigTab,
}: {
  object: StudioObject;
  onOpen: (record: StudioRecord) => void;
  initialConfigTab?: ConfigTab;
}) {
  const labelLocale = useAppLocale();
  const uiLocale = intlLocale(labelLocale);

  const t = useMessages(recordsMessages);

  const capabilities = collectionCapabilities(object);
  const canConfigureSourceForm =
    !capabilities.schema && !capabilities.customFields;
  const managedCustomer = object.config.studio?.business === "managed-customer";
  const managedObject = ["managed-customer", "managed-agency"].includes(
    object.config.studio?.business ?? "",
  );
  const crmIntegrationColumnAvailable = hasCrmIntegrationColumn(object);
  const availableFields = fieldEntries(object).filter(
    ([, field]) => field.type !== R2_ATTACHMENT_TYPE,
  );
  const fieldColumnKeys = availableFields.map(([key]) => key);
  const availableColumnKeys = crmIntegrationColumnAvailable
    ? [CRM_INTEGRATION_COLUMN_KEY, ...fieldColumnKeys]
    : fieldColumnKeys;
  const defaultFieldColumns = managedCustomer
    ? [
        "name",
        "agency_name",
        "person_type",
        "id_number",
        "email",
        "phone",
        "source",
      ].filter((name) => Boolean(object.config.fields[name]))
    : availableFields
        .filter(([, f]) => !f.hidden && f.type !== "Textarea")
        .map(([k]) => k);
  const defaults: Settings = {
    q: "",
    searchField: "",
    stage: "",
    filters: { logic: "and", conditions: [] },
    columns: crmIntegrationColumnAvailable
      ? [CRM_INTEGRATION_COLUMN_KEY, ...defaultFieldColumns]
      : defaultFieldColumns,
    columnOrder: availableColumnKeys,
    columnAliases: {},
    sort: {
      field:
        !supportsLocalRecordTools(object) && !managedCustomer
          ? (availableFields[0]?.[0] ?? "id")
          : "updated_at",
      order: "DESC",
    },
    group: "",
    mode: "table",
    perPage: 25,
  };
  const [s, setS] = useState(defaults),
    [config, setConfig] = useState(false),
    [configTab, setConfigTab] = useState<ConfigTab>(
      initialConfigTab === "form" && canConfigureSourceForm ? "form" : "table",
    ),
    [columnQuery, setColumnQuery] = useState(""),
    [draggedColumn, setDraggedColumn] = useState<string | null>(null),
    [dropColumn, setDropColumn] = useState<string | null>(null),
    [name, setName] = useState(""),
    [trash, setTrash] = useState(false),
    [viewId, setViewId] = useState(""),
    [pendingViewDeletion, setPendingViewDeletion] = useState<SavedView | null>(
      null,
    ),
    [savedTablePreferences, setSavedTablePreferences] =
      useState<TablePreferences>(() => tablePreferences(defaults)),
    [savingTablePreferences, setSavingTablePreferences] = useState(false),
    [formColumns, setFormColumns] = useState<1 | 2 | 3>(
      object.config.studio?.columns ?? 1,
    ),
    [savedFormColumns, setSavedFormColumns] = useState<1 | 2 | 3>(
      object.config.studio?.columns ?? 1,
    ),
    [savingFormColumns, setSavingFormColumns] = useState(false);
  const appliedDefaultFor = useRef<string | null>(null);
  const client = useQueryClient(),
    pipeline = getPipeline(object);
  const views = useQuery({
    queryKey: ["views", object.name],
    queryFn: () => api(`/views/${object.name}`),
    staleTime: 60_000,
  });
  const savedViews = Array.isArray(views.data?.data)
    ? (views.data.data as SavedView[])
    : [];
  useEffect(() => {
    if (!views.data || appliedDefaultFor.current === object.name) return;
    const preferences = normalizeTablePreferences(
      views.data.default?.config,
      defaults,
      availableColumnKeys,
    );
    setS((previous) => ({ ...previous, ...preferences }));
    setSavedTablePreferences(preferences);
    appliedDefaultFor.current = object.name;
  }, [availableColumnKeys, defaults, object.name, views.data]);
  useEffect(() => {
    if (initialConfigTab !== "form" || !canConfigureSourceForm) return;
    setConfigTab("form");
    setConfig(true);
  }, [canConfigureSourceForm, initialConfigTab]);
  const patch = (value: Partial<Settings>) => {
    setS((prev) => ({ ...prev, ...value }));
    setViewId("");
  };
  const applyDefaultView = () => {
    const preferences = normalizeTablePreferences(
      views.data?.default?.config,
      defaults,
      availableColumnKeys,
    );
    setS({ ...defaults, ...preferences });
    setSavedTablePreferences(preferences);
    setTrash(false);
    setViewId("");
  };
  const applySavedView = (view: SavedView) => {
    setS({
      ...defaults,
      ...view.config,
      ...normalizeTablePreferences(view.config, defaults, availableColumnKeys),
    });
    setTrash(false);
    setViewId(view.id);
  };
  const deleteSavedView = async () => {
    if (!pendingViewDeletion) return;
    const deleting = pendingViewDeletion;
    try {
      await api(`/views/${object.name}/${deleting.id}`, "DELETE");
      if (viewId === deleting.id) applyDefaultView();
      setPendingViewDeletion(null);
      await views.refetch();
      toast.success(t("Vista eliminada"));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const querySearch = useDebouncedSearch(s.q);
  const querySettings = { ...s, q: querySearch };
  const summary = useQuery({
    queryKey: [
      "summary",
      object.name,
      querySearch,
      s.searchField,
      s.stage,
      s.filters,
      s.group,
      trash,
    ],
    queryFn: () =>
      api(
        `/records/${object.name}/summary?` +
          new URLSearchParams({
            ...params(querySettings, trash),
            group: s.group || pipeline?.field || "",
          }),
      ),
    enabled: !!(s.group || pipeline),
  });
  const orderedColumnKeys = orderColumns(s.columnOrder, availableColumnKeys);
  const visibleColumnKeys = orderedColumnKeys.filter((key) =>
    s.columns.includes(key),
  );
  const normalizedColumnQuery = columnQuery.trim().toLocaleLowerCase(uiLocale);
  const showCrmIntegrationColumn =
    crmIntegrationColumnAvailable &&
    (!normalizedColumnQuery ||
      [CRM_INTEGRATION_COLUMN_LABEL, "HubSpot"].some((value) =>
        value.toLocaleLowerCase(uiLocale).includes(normalizedColumnQuery),
      ));
  const tableFields = orderedColumnKeys
    .map((key) => [key, object.config.fields[key]] as const)
    .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
      Boolean(entry[1]),
    )
    .filter(([key, field]) => {
      if (!normalizedColumnQuery) return true;
      return [
        key,
        resolveFieldLabel(field, labelLocale),
        s.columnAliases[key] ?? "",
      ].some((value) =>
        value.toLocaleLowerCase(uiLocale).includes(normalizedColumnQuery),
      );
    });
  const visibleColumnCount = s.columns.filter((key) =>
    availableColumnKeys.includes(key),
  ).length;
  const canExportCsv = collectionCapabilities(object).list;
  const currentTablePreferences = tablePreferences(s);
  const tablePreferencesDirty = !hasSameTablePreferences(
    currentTablePreferences,
    savedTablePreferences,
  );
  const columnLabel = (key: string) =>
    key === CRM_INTEGRATION_COLUMN_KEY
      ? CRM_INTEGRATION_COLUMN_LABEL
      : s.columnAliases[key]?.trim() ||
        (object.config.fields[key]
          ? resolveFieldLabel(object.config.fields[key], labelLocale)
          : key);
  const reorderColumn = (source: string, target: string) =>
    patch({
      columnOrder: moveColumn(orderedColumnKeys, source, target),
    });
  const moveColumnBy = (key: string, offset: number) => {
    const currentIndex = orderedColumnKeys.indexOf(key);
    const target = orderedColumnKeys[currentIndex + offset];
    if (target) reorderColumn(key, target);
  };
  const exportCsv = async () => {
    const exportableColumnKeys = visibleColumnKeys.filter(
      (key) => key !== CRM_INTEGRATION_COLUMN_KEY,
    );
    if (!exportableColumnKeys.length) {
      toast.error(t("Muestra al menos una columna antes de exportar."));
      return;
    }
    const query = new URLSearchParams({
      columns: JSON.stringify(exportableColumnKeys),
      headers: JSON.stringify(exportableColumnKeys.map(columnLabel)),
      filters: JSON.stringify(s.filters),
      sort: s.sort.field,
      order: s.sort.order,
      q: s.q,
      trash: String(trash),
      ...(s.searchField ? { searchField: s.searchField } : {}),
      ...(s.stage ? { stage: s.stage } : {}),
    });
    try {
      await downloadCrm(
        `/api/export/${encodeURIComponent(object.name)}?${query}`,
        recordsCsvFilename(object.name),
      );
      toast.success(t("CSV descargado"));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const saveTablePreferences = async () => {
    const preferences = tablePreferences(s);
    setSavingTablePreferences(true);
    try {
      const result = await api<{ data: { config: TablePreferences } }>(
        `/views/${object.name}/default`,
        "PUT",
        { config: preferences },
      );
      const saved = normalizeTablePreferences(
        result.data.config,
        defaults,
        availableColumnKeys,
      );
      setS((previous) => ({ ...previous, ...saved }));
      setSavedTablePreferences(saved);
      client.setQueryData(["views", object.name], (previous: any) => ({
        ...(previous ?? { data: [] }),
        default: { config: saved },
      }));
      toast.success(t("Cambios de tabla guardados"));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingTablePreferences(false);
    }
  };
  const [formFields, setFormFields] = useState(object.config.fields);
  const [savedFormFields, setSavedFormFields] = useState(object.config.fields);
  const formColumnsDirty =
    formColumns !== savedFormColumns ||
    JSON.stringify(formFields) !== JSON.stringify(savedFormFields);
  const saveFormColumns = async () => {
    setSavingFormColumns(true);
    try {
      const updated = await api<{ data: StudioObject }>(
        `/objects/${object.name}`,
        "PUT",
        {
          ...object,
          version: object.version ?? 1,
          config: {
            ...object.config,
            fields: formFields,
            studio: { ...object.config.studio, columns: formColumns },
          },
        },
      );
      setSavedFormColumns(formColumns);
      setSavedFormFields(formFields);
      client.setQueryData(
        getListObjectsQueryKey(),
        (previous: { data: StudioObject[] } | undefined) =>
          previous
            ? {
                ...previous,
                data: previous.data.map((entry) =>
                  entry.name === updated.data.name ? updated.data : entry,
                ),
              }
            : previous,
      );
      toast.success(t("Distribución del formulario guardada"));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingFormColumns(false);
    }
  };
  return (
    <>
      <div className="records-panel">
        <RecordsLiveSync objectName={object.name} />
        <div className="records-panel-toolbar">
          <div className="view-tabs">
            <button
              className={!viewId ? "selected" : ""}
              onClick={applyDefaultView}
            >
              {t("Todos los registros")}
            </button>
            {savedViews.map((view) => (
              <span className="view-tab" key={view.id}>
                <button
                  className={viewId === view.id ? "selected" : ""}
                  onClick={() => applySavedView(view)}
                >
                  {view.name}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("Eliminar vista %{p0}", { p0: view.name })}
                      onClick={() => setPendingViewDeletion(view)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {t("Eliminar vista")}
                  </TooltipContent>
                </Tooltip>
              </span>
            ))}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="save-view-trigger"
                  aria-label={t("Configurar vista")}
                  aria-expanded={config}
                  onClick={() => {
                    setColumnQuery("");
                    setConfigTab("table");
                    setConfig(true);
                  }}
                >
                  <SlidersHorizontal size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t("Configurar vista")}
              </TooltipContent>
            </Tooltip>
          </div>
          <RecordHistorySettingsButton object={object} />
          <RecordsCommandToolbar
            object={object}
            capabilities={capabilities}
            searchField={s.searchField}
            searchQuery={s.q}
            onSearchFieldChange={(searchField) => patch({ searchField })}
            onSearchQueryChange={(q) => patch({ q })}
            searchOptions={visibleColumnKeys.map((key) => ({
              key,
              label: columnLabel(key),
            }))}
            filters={s.filters}
            onFiltersChange={(filters) => patch({ filters })}
            canExportCsv={canExportCsv}
            onExportCsv={() => void exportCsv()}
            trash={trash}
            onTrashToggle={() => {
              setTrash(!trash);
              patch({ mode: "table" });
            }}
            showPipelineToggle={Boolean(pipeline)}
            mode={s.mode}
            onModeChange={(mode) => patch({ mode })}
            stage={s.stage}
            onStageChange={(stage) => patch({ stage })}
            pipelineFieldLabel={
              pipeline?.field
                ? object.config.fields[pipeline.field]
                  ? resolveFieldLabel(
                      object.config.fields[pipeline.field],
                      labelLocale,
                    )
                  : undefined
                : undefined
            }
            stageOptions={
              pipeline?.field
                ? (object.config.fields[pipeline.field].options ?? []).map(
                    (option) => ({
                      value: String(option.value),
                      label: option.label,
                    }),
                  )
                : []
            }
            supportsLocalRecordTools={supportsLocalRecordTools(object)}
            showDelete={collectionCapabilities(object).delete}
          />
        </div>
        <div className="records-panel-body">
          {summary.error && <p role="alert">{summary.error.message}</p>}
          {summary.data && (
            <div className="summary-strip">
              {summary.data.data.map((g: any) => (
                <div key={String(g.value)}>
                  <span>{display(g.value, uiLocale)}</span>
                  <strong>
                    {g.count} {t("registros")}
                  </strong>
                  {pipeline?.amountField && (
                    <small>
                      {money(
                        g.amount,
                        String(
                          object.config.fields[pipeline.amountField]?.config
                            ?.currency || "COP",
                        ),
                        typeof object.config.fields[pipeline.amountField]
                          ?.config?.decimals === "number"
                          ? Number(
                              object.config.fields[pipeline.amountField]?.config
                                ?.decimals,
                            )
                          : object.config.fields[pipeline.amountField]?.config
                                ?.integer
                            ? 0
                            : 2,
                        uiLocale,
                      )}
                    </small>
                  )}
                </div>
              ))}
            </div>
          )}
          {s.mode === "pipeline" && pipeline && !trash ? (
            <div className="kanban">
              {(object.config.fields[pipeline.field].options ?? [])
                .filter((o) => !s.stage || o.value === s.stage)
                .map((o) => (
                  <PipelineColumn
                    key={String(o.value)}
                    object={object}
                    settings={querySettings}
                    stage={String(o.value)}
                    label={o.label}
                    onOpen={onOpen}
                  />
                ))}
              {!s.stage && (
                <PipelineColumn
                  object={object}
                  settings={querySettings}
                  stage=""
                  label={t("Sin etapa")}
                  onOpen={onOpen}
                />
              )}
            </div>
          ) : (
            <ListBase
              key={`${object.name}:${trash}`}
              resource={object.name}
              perPage={s.perPage}
              sort={s.sort}
              filter={{
                ...params(querySettings, trash),
                __collectionSearch: capabilities.search,
                __collectionFilter: capabilities.filter,
                __collectionSort: capabilities.sort,
              }}
              disableSyncWithLocation
              storeKey={false}
            >
              <RetainedListResults
                scope={`${getStudioRuntime().localWorkspace?.scope ?? getStudioRuntime().apiBasePath}:${object.name}:${trash}`}
              >
                <RecordTable
                  object={object}
                  columnAliases={s.columnAliases}
                  columns={visibleColumnKeys}
                  trash={trash}
                  onOpen={onOpen}
                  desiredSort={s.sort}
                  desiredPerPage={s.perPage}
                  onPerPage={(perPage) =>
                    setS((prev) => ({ ...prev, perPage }))
                  }
                  onSort={(sort) => setS((prev) => ({ ...prev, sort }))}
                  onConfigureColumns={() => {
                    setConfigTab("table");
                    setConfig(true);
                  }}
                />
              </RetainedListResults>
            </ListBase>
          )}
        </div>
      </div>
      {config && (
        <Drawer
          open
          direction="right"
          onOpenChange={(open) => {
            setConfig(open);
            if (!open) setColumnQuery("");
          }}
        >
          <DrawerContent className="view-config-drawer">
            <DrawerHeader className="view-config-header">
              <div className="view-config-title-row">
                <div>
                  <DrawerTitle>{t("Configurar vista")}</DrawerTitle>
                  <DrawerDescription>
                    {configTab === "form"
                      ? t(
                          "Define cómo se distribuyen los campos al crear y editar.",
                        )
                      : t(
                          "Ajusta los nombres, la visibilidad y el orden de esta tabla.",
                        )}
                  </DrawerDescription>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("Cerrar configuración")}
                      onClick={() => setConfig(false)}
                    >
                      <X size={17} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {t("Cerrar configuración")}
                  </TooltipContent>
                </Tooltip>
              </div>
              {configTab === "table" && (
                <p className="view-config-count" role="status">
                  {visibleColumnCount} {t("de")} {availableColumnKeys.length}{" "}
                  {t("columnas visibles")}
                </p>
              )}
              {canConfigureSourceForm && (
                <div
                  className="view-config-tabs"
                  role="tablist"
                  aria-label={t("Área a configurar")}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={configTab === "table"}
                    onClick={() => setConfigTab("table")}
                  >
                    {t("Tabla")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={configTab === "form"}
                    onClick={() => setConfigTab("form")}
                  >
                    {t("Formulario")}
                  </button>
                </div>
              )}
            </DrawerHeader>
            <div className="view-config">
              {canConfigureSourceForm && configTab === "form" && (
                <Suspense
                  fallback={<p role="status">{t("Cargando configuración…")}</p>}
                >
                  <section
                    className="view-config-form"
                    aria-label={t("Formulario")}
                  >
                    <h3>{t("Distribución del formulario")}</h3>
                    <FormColumnPicker
                      className="form-column-picker--compact"
                      name="view-form-columns"
                      value={formColumns}
                      onChange={setFormColumns}
                    />
                    <FormLabelsEditor
                      fields={formFields}
                      onChange={setFormFields}
                    />
                    <CollectionOptionsEditor
                      object={object}
                      fields={formFields}
                      onChange={setFormFields}
                    />
                  </section>
                </Suspense>
              )}
              <section
                className="view-config-columns"
                aria-label={t("Columnas de la tabla")}
                hidden={configTab !== "table"}
              >
                <div className="view-config-search">
                  <Search size={16} aria-hidden="true" />
                  <label
                    className="view-config-sr-only"
                    htmlFor="column-search"
                  >
                    {t("Buscar columna")}
                  </label>
                  <Input
                    id="column-search"
                    type="search"
                    aria-label={t("Buscar columna")}
                    placeholder={t("Buscar columna")}
                    value={columnQuery}
                    onChange={(event) => setColumnQuery(event.target.value)}
                  />
                </div>
                <div className="view-config-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("Mostrar todas las columnas")}
                    onClick={() => patch({ columns: availableColumnKeys })}
                  >
                    {t("Mostrar todas")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("Ocultar todas las columnas")}
                    onClick={() => patch({ columns: [] })}
                  >
                    {t("Ocultar todas")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("Restablecer columnas")}
                    onClick={() =>
                      patch({
                        columns: defaults.columns,
                        columnOrder: defaults.columnOrder,
                        columnAliases: defaults.columnAliases,
                      })
                    }
                  >
                    {t("Restablecer")}
                  </Button>
                </div>
                {columnQuery && (
                  <p className="view-config-search-hint">
                    {t("Borra la búsqueda para reordenar columnas.")}
                  </p>
                )}
                {showCrmIntegrationColumn || tableFields.length ? (
                  <ol
                    className="view-column-list"
                    aria-label={t("Columnas de la tabla")}
                  >
                    {showCrmIntegrationColumn && (
                      <li
                        aria-label={t("Columna %{p0}", {
                          p0: CRM_INTEGRATION_COLUMN_LABEL,
                        })}
                        className="view-column-item view-column-item--system"
                      >
                        <button
                          aria-label={t("Reordenar CRM (columna fija)")}
                          className="view-column-grip"
                          disabled
                          title={t("La columna CRM permanece al inicio")}
                          type="button"
                        >
                          <GripVertical aria-hidden="true" size={17} />
                        </button>
                        <div className="view-column-details">
                          <strong className="view-column-system-label">
                            {CRM_INTEGRATION_COLUMN_LABEL}
                          </strong>
                          <span className="view-column-source">
                            {t("Integración del registro")}
                          </span>
                        </div>
                        <div className="view-column-visibility">
                          <Switch
                            aria-label={t("Visible %{p0}", {
                              p0: CRM_INTEGRATION_COLUMN_LABEL,
                            })}
                            checked={s.columns.includes(
                              CRM_INTEGRATION_COLUMN_KEY,
                            )}
                            onCheckedChange={(checked) =>
                              patch({
                                columns: checked
                                  ? [
                                      CRM_INTEGRATION_COLUMN_KEY,
                                      ...s.columns.filter(
                                        (column) =>
                                          column !== CRM_INTEGRATION_COLUMN_KEY,
                                      ),
                                    ]
                                  : s.columns.filter(
                                      (column) =>
                                        column !== CRM_INTEGRATION_COLUMN_KEY,
                                    ),
                              })
                            }
                          />
                          <span>
                            {s.columns.includes(CRM_INTEGRATION_COLUMN_KEY)
                              ? t("Visible")
                              : t("Oculta")}
                          </span>
                        </div>
                      </li>
                    )}
                    {tableFields.map(([key, field]) => (
                      <li
                        aria-label={t("Campo %{p0}", {
                          p0: resolveFieldLabel(field, labelLocale),
                        })}
                        className={`view-column-item${
                          draggedColumn === key ? " is-dragging" : ""
                        }${dropColumn === key ? " is-drop-target" : ""}`}
                        key={key}
                        onDragOver={(event) => {
                          if (!draggedColumn || columnQuery) return;
                          event.preventDefault();
                          setDropColumn(key);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedColumn && !columnQuery)
                            reorderColumn(draggedColumn, key);
                          setDraggedColumn(null);
                          setDropColumn(null);
                        }}
                      >
                        <button
                          aria-label={t(
                            "Reordenar %{p0} con Alt y las flechas",
                            { p0: columnLabel(key) },
                          )}
                          className="view-column-grip"
                          disabled={Boolean(columnQuery)}
                          draggable={!columnQuery}
                          onDragEnd={() => {
                            setDraggedColumn(null);
                            setDropColumn(null);
                          }}
                          onDragStart={(event) => {
                            if (columnQuery) return;
                            if (event.dataTransfer)
                              event.dataTransfer.effectAllowed = "move";
                            setDraggedColumn(key);
                          }}
                          onKeyDown={(event) => {
                            if (!event.altKey) return;
                            if (event.key === "ArrowUp") {
                              event.preventDefault();
                              moveColumnBy(key, -1);
                            }
                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              moveColumnBy(key, 1);
                            }
                          }}
                          type="button"
                          title={t("Arrastra para reordenar")}
                        >
                          <GripVertical aria-hidden="true" size={17} />
                        </button>
                        <div className="view-column-details">
                          <label
                            className="view-column-alias"
                            htmlFor={`column-alias-${key}`}
                          >
                            <span className="view-config-sr-only">
                              {t("Alias de")}{" "}
                              {resolveFieldLabel(field, labelLocale)}
                            </span>
                            <Input
                              id={`column-alias-${key}`}
                              aria-label={t("Alias de %{p0}", {
                                p0: resolveFieldLabel(field, labelLocale),
                              })}
                              maxLength={100}
                              value={
                                s.columnAliases[key] ??
                                resolveFieldLabel(field, labelLocale)
                              }
                              onChange={(event) =>
                                patch({
                                  columnAliases: {
                                    ...s.columnAliases,
                                    [key]: event.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                          <span className="view-column-source">
                            {t("Campo de origen:")} {key}
                          </span>
                        </div>
                        <div className="view-column-visibility">
                          <Switch
                            aria-label={t("Visible %{p0}", {
                              p0: resolveFieldLabel(field, labelLocale),
                            })}
                            checked={s.columns.includes(key)}
                            onCheckedChange={(checked) =>
                              patch({
                                columns: checked
                                  ? [...s.columns, key]
                                  : s.columns.filter(
                                      (column) => column !== key,
                                    ),
                              })
                            }
                          />
                          <span>
                            {s.columns.includes(key)
                              ? t("Visible")
                              : t("Oculta")}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="view-config-empty">
                    {t("No encontramos columnas con ese nombre.")}
                  </p>
                )}
              </section>
              {(capabilities.sort !== false ||
                supportsLocalRecordTools(object)) && (
                <section
                  className="view-config-advanced"
                  aria-label={t("Orden y agrupación")}
                  hidden={configTab !== "table"}
                >
                  <h3>{t("Orden y agrupación")}</h3>
                  {capabilities.sort !== false && (
                    <>
                      <label>
                        {t("Ordenar por")}
                        <select
                          className="select-input"
                          value={s.sort.field}
                          onChange={(e) =>
                            patch({
                              sort: { ...s.sort, field: e.target.value },
                            })
                          }
                        >
                          {supportsLocalRecordTools(object) && (
                            <option value="updated_at">
                              {t("Última actualización")}
                            </option>
                          )}
                          {availableFields.map(([key, f]) => (
                            <option key={key} value={key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <select
                        aria-label={t("Dirección del orden")}
                        className="select-input"
                        value={s.sort.order}
                        onChange={(e) =>
                          patch({
                            sort: {
                              ...s.sort,
                              order: e.target.value as "ASC" | "DESC",
                            },
                          })
                        }
                      >
                        <option value="ASC">{t("Ascendente")}</option>
                        <option value="DESC">{t("Descendente")}</option>
                      </select>
                    </>
                  )}
                  {supportsLocalRecordTools(object) && (
                    <label>
                      {t("Agrupar resumen por")}
                      <select
                        className="select-input"
                        value={s.group}
                        onChange={(e) => patch({ group: e.target.value })}
                      >
                        <option value="">
                          {pipeline
                            ? t("Etapa del pipeline")
                            : t("Sin agrupación")}
                        </option>
                        {availableFields
                          .filter(([, f]) => !f.config?.multiple)
                          .map(([key, f]) => (
                            <option key={key} value={key}>
                              {f.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </section>
              )}
              <section
                className="view-config-advanced view-config-saved"
                aria-label={t("Guardar vista")}
                hidden={configTab !== "table"}
              >
                <h3>{t("Guardar vista")}</h3>
                <form
                  className="save-view-row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api(`/views/${object.name}`, "POST", {
                        name,
                        config: s,
                      });
                      setName("");
                      await views.refetch();
                      toast.success(t("Vista guardada"));
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  <Input
                    required
                    maxLength={80}
                    aria-label={t("Nombre de vista")}
                    placeholder={t("Nombre de esta vista")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Button type="submit">
                    <Save size={15} />
                    {t("Guardar vista")}
                  </Button>
                </form>
                {savedViews.length > 0 && (
                  <section
                    className="view-saved-list"
                    aria-label={t("Mis vistas")}
                  >
                    <h4>{t("Mis vistas")}</h4>
                    <ul>
                      {savedViews.map((view) => (
                        <li key={view.id}>
                          <button
                            className={viewId === view.id ? "selected" : ""}
                            type="button"
                            onClick={() => applySavedView(view)}
                          >
                            {view.name}
                          </button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t("Eliminar vista %{p0}", {
                                  p0: view.name,
                                })}
                                onClick={() => setPendingViewDeletion(view)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" sideOffset={6}>
                              {t("Eliminar vista")}
                            </TooltipContent>
                          </Tooltip>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </section>
            </div>
            <footer className="view-config-footer">
              {configTab === "form" ? (
                <>
                  <p className="view-config-save-status" role="status">
                    {savingFormColumns
                      ? t("Guardando cambios…")
                      : formColumnsDirty
                        ? t("Cambios sin guardar")
                        : t("Cambios guardados")}
                  </p>
                  <Button
                    type="button"
                    disabled={!formColumnsDirty || savingFormColumns}
                    onClick={() => void saveFormColumns()}
                  >
                    <Save size={15} />
                    {savingFormColumns ? t("Guardando…") : t("Guardar cambios")}
                  </Button>
                </>
              ) : (
                <>
                  <p className="view-config-save-status" role="status">
                    {savingTablePreferences
                      ? t("Guardando cambios…")
                      : tablePreferencesDirty
                        ? t("Cambios sin guardar")
                        : t("Cambios guardados")}
                  </p>
                  <Button
                    type="button"
                    disabled={!tablePreferencesDirty || savingTablePreferences}
                    onClick={() => void saveTablePreferences()}
                  >
                    <Save size={15} />
                    {savingTablePreferences
                      ? t("Guardando…")
                      : t("Guardar cambios")}
                  </Button>
                </>
              )}
            </footer>
          </DrawerContent>
        </Drawer>
      )}
      <Confirm
        isOpen={Boolean(pendingViewDeletion)}
        title={t("Eliminar vista %{p0}", {
          p0: pendingViewDeletion?.name ?? "",
        })}
        content={t(
          "Se eliminará la vista “%{p0}”. Esta acción no se puede deshacer.",
          { p0: pendingViewDeletion?.name ?? "" },
        )}
        confirm="Eliminar"
        confirmColor="warning"
        onClose={() => setPendingViewDeletion(null)}
        onConfirm={() => void deleteSavedView()}
      />
    </>
  );
}
function RecordTable({
  object,
  columns,
  columnAliases,
  trash,
  onOpen,
  onSort,
  desiredSort,
  desiredPerPage,
  onPerPage,
  onConfigureColumns,
}: {
  object: StudioObject;
  columns: string[];
  columnAliases: Record<string, string>;
  trash: boolean;
  onOpen: (r: StudioRecord) => void;
  onSort: (sort: Settings["sort"]) => void;
  desiredSort: Settings["sort"];
  desiredPerPage: number;
  onPerPage: (n: number) => void;
  onConfigureColumns: () => void;
}) {
  const t = useMessages(recordsMessages);
  const labelLocale = useAppLocale();

  const {
    data = EMPTY_RECORDS,
    total,
    isPending,
    error,
    sort,
    setSort,
    page,
    perPage,
    setPerPage,
  } = useListContext<StudioRecord>();
  const { canScrollLeft, canScrollRight, hasOverflow, scrollByPage, shellRef } =
    useHorizontalTableScroll(columns, data.length);
  useEffect(() => {
    setSort(desiredSort);
  }, [desiredSort.field, desiredSort.order]);
  useEffect(() => {
    setPerPage(desiredPerPage);
  }, [desiredPerPage]);
  useEffect(() => {
    onPerPage(perPage);
  }, [perPage]);
  useEffect(() => {
    onSort(sort);
  }, [sort.field, sort.order]);
  const primaryColumnKey = columns.find(
    (key) => key !== CRM_INTEGRATION_COLUMN_KEY,
  );
  if (error) return <div role="alert">{error.message}</div>;
  if (isPending)
    return (
      <TableSkeleton
        columns={Math.max(
          columns.filter((k) => k !== CRM_INTEGRATION_COLUMN_KEY).length,
          4,
        )}
        rows={Math.min(perPage || 6, 8)}
        hasCheckbox={true}
        ariaLabel="Cargando registros…"
      />
    );
  return (
    <>
      {trash && (
        <p className="trash-note">
          {t(
            "Papelera · Los registros conservan su historial y archivos. Puedes restaurarlos si cumplen la estructura actual.",
          )}
        </p>
      )}
      {!columns.length ? (
        <section className="records-empty-columns" aria-live="polite">
          <Columns3 aria-hidden="true" size={22} />
          <div>
            <strong>{t("No hay columnas visibles")}</strong>
            <p>
              {t(
                "Abre Configurar vista para mostrar las columnas que necesites.",
              )}
            </p>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={onConfigureColumns}
            >
              {t("Configurar columnas")}
            </Button>
          </div>
        </section>
      ) : data.length ? (
        <section
          className="records-list"
          aria-label={t("Registros de %{p0}", { p0: object.label })}
        >
          <div
            ref={shellRef}
            className="records-table-shell"
            data-horizontal-overflow={hasOverflow || undefined}
            data-scroll-left={canScrollLeft || undefined}
            data-scroll-right={canScrollRight || undefined}
          >
            <DataTable
              virtualize
              total={total}
              rowOffset={((page ?? 1) - 1) * perPage}
              className="records-table"
              resource={object.name}
              bulkActionButtons={false}
              bulkActionsToolbar={
                collectionCapabilities(object).delete && !trash ? (
                  <RecordsBulkActionsToolbar object={object} />
                ) : undefined
              }
              rowClick={(_id, _resource, record) => {
                if (!trash && collectionCapabilities(object).read)
                  onOpen(record as StudioRecord);
                return false;
              }}
            >
              {columns.map((key) =>
                key === CRM_INTEGRATION_COLUMN_KEY ? (
                  <DataTable.Col
                    key={key}
                    source={CRM_INTEGRATION_COLUMN_KEY}
                    label={CRM_INTEGRATION_COLUMN_LABEL}
                    disableSort
                    className="records-table-origin-column"
                    headerClassName="records-table-origin-column"
                    render={(r) => <RecordOriginLinks record={r} iconOnly />}
                  />
                ) : (
                  <DataTable.Col
                    key={key}
                    className={
                      key === primaryColumnKey
                        ? "records-table-primary-column"
                        : undefined
                    }
                    disableSort={collectionCapabilities(object).sort === false}
                    source={key}
                    label={
                      columnAliases[key]?.trim() ||
                      resolveFieldLabel(object.config.fields[key], labelLocale)
                    }
                    render={(r) => {
                      const cell = (
                        <div className={key === "name" ? "record-name" : ""}>
                          {object.config.fields[key].config?.relation ? (
                            <RelatedValue
                              objectName={String(
                                object.config.fields[key].config?.relation,
                              )}
                              value={r[key]}
                            />
                          ) : object.config.studio?.business ===
                              "managed-customer" && key === "email" ? (
                            displayCustomerEmail(r[key])
                          ) : (
                            <FieldValueDisplay
                              value={r[key]}
                              field={object.config.fields[key]}
                            />
                          )}
                        </div>
                      );
                      return key === primaryColumnKey &&
                        !trash &&
                        collectionCapabilities(object).read ? (
                        <div className="grid justify-items-start gap-1">
                          {object.config.fields[key].type === "RichText" &&
                            cell}
                          <button
                            type="button"
                            className="text-left text-primary underline-offset-4 hover:underline focus-visible:underline"
                            aria-label={t("Abrir %{p0}", {
                              p0: String(r[key] ?? r.id),
                            })}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(r as StudioRecord);
                            }}
                          >
                            {object.config.fields[key].type === "RichText"
                              ? t("Open record")
                              : cell}
                          </button>
                        </div>
                      ) : (
                        cell
                      );
                    }}
                  />
                ),
              )}
              <RecordTableRowActions object={object} trash={trash} />
            </DataTable>
            {hasOverflow && (
              <div className="records-table-scroll-controls">
                {canScrollLeft && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("Ver columnas a la izquierda")}
                        className="records-table-scroll-control records-table-scroll-control-left"
                        onClick={() => scrollByPage("left")}
                        size="icon"
                        type="button"
                        variant="secondary"
                      >
                        <ChevronLeft aria-hidden="true" size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {t("Ver columnas a la izquierda")}
                    </TooltipContent>
                  </Tooltip>
                )}
                {canScrollRight && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("Ver columnas a la derecha")}
                        className="records-table-scroll-control records-table-scroll-control-right"
                        onClick={() => scrollByPage("right")}
                        size="icon"
                        type="button"
                        variant="secondary"
                      >
                        <ChevronRight aria-hidden="true" size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {t("Ver columnas a la derecha")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
          <RecordsFooter
            dataLength={data.length}
            object={object}
            total={total}
          />
        </section>
      ) : (
        <div className="empty-state">
          <Search size={28} />
          <h2>{t("No hay registros para mostrar")}</h2>
          <p>{t("Prueba otros filtros o crea un registro.")}</p>
        </div>
      )}
      {!data.length && (
        <RecordsFooter dataLength={data.length} object={object} total={total} />
      )}
    </>
  );
}

function RecordTableRowActions({
  object,
  trash,
}: {
  object: StudioObject;
  trash: boolean;
}) {
  const t = useMessages(recordsMessages);

  const canDelete = collectionCapabilities(object).delete;
  const canRestore = trash && supportsLocalRecordTools(object);
  if (!canDelete && !canRestore) return null;
  return (
    <DataTable.Col
      label={t("Acciones")}
      disableSort
      className="records-table-actions-column"
      headerClassName="records-table-actions-column"
    >
      <RecordRowAction object={object} trash={trash} />
    </DataTable.Col>
  );
}

async function recordVersionsForBulkDelete(
  objectName: string,
  ids: Array<string | number>,
  records: StudioRecord[],
) {
  const versions: Record<string, number> = {};
  const missing: string[] = [];
  for (const id of ids) {
    const record = records.find((row) => row.id === id);
    if (record?._version != null) versions[String(id)] = record._version;
    else missing.push(String(id));
  }
  if (missing.length) {
    const fetched = await Promise.all(
      missing.map((id) =>
        api<{ data: StudioRecord }>(
          `/records/${objectName}/${encodeURIComponent(id)}`,
        ).then((response) => response.data),
      ),
    );
    for (const record of fetched) {
      if (record._version != null)
        versions[String(record.id)] = record._version;
    }
  }
  const unresolved = ids.filter((id) => versions[String(id)] == null);
  if (unresolved.length) {
    throw new Error(
      "No se pudieron obtener las versiones de algunos registros. Recarga e inténtalo de nuevo.",
    );
  }
  return versions;
}

function RecordsBulkActionsToolbar({ object }: { object: StudioObject }) {
  const t = useMessages(recordsMessages);

  const { selectedIds, data, onUnselectItems, refetch } =
    useListContext<StudioRecord>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hubspotArchive = object.config.studio?.collection?.kind === "crm";
  const permanent = !supportsLocalRecordTools(object);
  const count = selectedIds?.length ?? 0;
  const runDelete = async () => {
    if (!selectedIds?.length) return;
    setBusy(true);
    try {
      const versions = await recordVersionsForBulkDelete(
        object.name,
        selectedIds,
        data ?? EMPTY_RECORDS,
      );
      const result = await api<{
        data: Array<{ id: string; ok: boolean; error?: string }>;
      }>(`/records/${object.name}/bulk`, "POST", {
        action: "delete",
        records: selectedIds.map((id) => ({
          id: String(id),
          version: versions[String(id)],
        })),
      });
      const failures = result.data.filter((row) => !row.ok);
      if (failures.length) {
        throw new Error(
          failures
            .map((row) => row.error)
            .filter(Boolean)
            .join(" ") || t("No se pudieron eliminar algunos registros."),
        );
      }
      toast.success(
        permanent
          ? count === 1
            ? t("Registro eliminado")
            : t("%{p0} registros eliminados", { p0: count })
          : count === 1
            ? t("Registro movido a la papelera")
            : t("%{p0} registros movidos a la papelera", { p0: count }),
      );
      setConfirmOpen(false);
      onUnselectItems(true);
      await refetch();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BulkActionsToolbar>
        <SelectAllButton />
        <Button
          type="button"
          variant="destructive"
          className="h-9"
          disabled={busy}
          aria-label={t("Eliminar seleccionados")}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 size={15} />
          {t("Eliminar")}
        </Button>
      </BulkActionsToolbar>
      <Confirm
        isOpen={confirmOpen}
        title={
          count === 1
            ? t("Eliminar registro")
            : t("Eliminar %{p0} registros", { p0: count })
        }
        content={
          hubspotArchive
            ? t("¿Archivar %{p0} en HubSpot?", {
                p0:
                  count === 1
                    ? t("este registro")
                    : t("%{p0} registros", { p0: count }),
              })
            : permanent
              ? count === 1
                ? t(
                    "¿Eliminar permanentemente este registro? Esta acción no se puede deshacer.",
                  )
                : t(
                    "¿Eliminar permanentemente %{p0} registros? Esta acción no se puede deshacer.",
                    { p0: count },
                  )
              : count === 1
                ? "¿Mover este registro a la papelera?"
                : t("¿Mover %{p0} registros a la papelera?", { p0: count })
        }
        confirm={
          hubspotArchive
            ? t("Archivar en HubSpot")
            : permanent
              ? t("Eliminar permanentemente")
              : t("Mover a papelera")
        }
        confirmColor="warning"
        loading={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void runDelete()}
      />
    </>
  );
}

function RecordRowAction({
  object,
  trash,
}: {
  object: StudioObject;
  trash: boolean;
}) {
  const t = useMessages(recordsMessages);

  const record = useRecordContext<StudioRecord>();
  const { refetch } = useListContext<StudioRecord>();
  if (!record) return null;
  const hubspotArchive = object.config.studio?.collection?.kind === "crm";
  const permanent = !supportsLocalRecordTools(object);
  const [pending, setPending] = useState<"delete" | "restore" | null>(null);
  const [busy, setBusy] = useState(false);
  const canDelete = collectionCapabilities(object).delete;
  const canRestore = trash && supportsLocalRecordTools(object);
  const label = recordLabel(record);
  if (!canDelete && !canRestore) return null;
  const close = () => setPending(null);
  const run = async () => {
    setBusy(true);
    try {
      if (pending === "restore") {
        await api(`/records/${object.name}/${record.id}/restore`, "POST", {
          version: record._version,
        });
        toast.success(t("Registro restaurado"));
      } else {
        await api(
          `/records/${object.name}/${record.id}?version=${record._version}`,
          "DELETE",
        );
        toast.success(
          permanent
            ? t("Registro eliminado")
            : t("Registro movido a la papelera"),
        );
      }
      close();
      await refetch();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="records-table-row-actions"
      onClick={(event) => event.stopPropagation()}
    >
      {canRestore ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("Restaurar %{p0}", { p0: label })}
              onClick={() => setPending("restore")}
            >
              <ArchiveRestore size={15} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            {t("Restaurar")}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="records-table-row-delete"
              aria-label={t("Eliminar %{p0}", { p0: label })}
              onClick={() => setPending("delete")}
            >
              <Trash2 size={15} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            {permanent ? t("Eliminar") : t("Mover a papelera")}
          </TooltipContent>
        </Tooltip>
      )}
      <Confirm
        isOpen={pending === "delete"}
        title={t("Eliminar %{p0}", { p0: label })}
        content={
          hubspotArchive
            ? "¿Archivar este registro en HubSpot?"
            : permanent
              ? t(
                  "¿Eliminar permanentemente este registro? Esta acción no se puede deshacer.",
                )
              : "¿Mover este registro a la papelera?"
        }
        confirm={
          hubspotArchive
            ? t("Archivar en HubSpot")
            : permanent
              ? t("Eliminar permanentemente")
              : t("Mover a papelera")
        }
        confirmColor="warning"
        loading={busy}
        onClose={close}
        onConfirm={() => void run()}
      />
      <Confirm
        isOpen={pending === "restore"}
        title={t("Restaurar %{p0}", { p0: label })}
        content="El registro volverá a la lista principal si cumple la estructura actual."
        confirm="Restaurar"
        loading={busy}
        onClose={close}
        onConfirm={() => void run()}
      />
    </div>
  );
}

function RecordsFooter({
  dataLength,
  object,
  total,
}: {
  dataLength: number;
  object: StudioObject;
  total: number | undefined;
}) {
  const t = useMessages(recordsMessages);

  return (
    <div className="list-footer">
      <span>
        {total === undefined
          ? t("%{p0} registros en esta página", { p0: dataLength })
          : t("%{p0} registros", { p0: total })}
      </span>
      <ListPagination
        rowsPerPageOptions={
          object.config.studio?.collection
            ? [10, 25, 50, 100]
            : [10, 25, 50, 100, 200]
        }
      />
    </div>
  );
}
function PipelineColumn({
  object,
  settings,
  stage,
  label,
  onOpen,
}: {
  object: StudioObject;
  settings: Settings;
  stage: string;
  label: string;
  onOpen: (r: StudioRecord) => void;
}) {
  const labelLocale = useAppLocale();
  const uiLocale = intlLocale(labelLocale);

  const t = useMessages(recordsMessages);

  const [page, setPage] = useState(1);
  const pipeline = getPipeline(object)!;
  const client = useQueryClient();
  const filters = settings.filters;
  const query = useQuery({
    queryKey: [
      "pipeline",
      object.name,
      stage,
      settings.q,
      settings.searchField,
      settings.filters,
      page,
      settings.sort,
    ],
    queryFn: () =>
      api(
        `/records/${object.name}?` +
          new URLSearchParams({
            ...params(settings),
            filters: JSON.stringify(filters),
            emptyStage: String(!stage),
            stage,
            page: String(page),
            perPage: "20",
            sort: settings.sort.field,
            order: settings.sort.order,
          }),
      ),
  });
  useEffect(
    () => setPage(1),
    [settings.q, settings.searchField, settings.filters],
  );
  async function move(record: StudioRecord, next: string) {
    try {
      await api(`/records/${object.name}/${record.id}`, "PATCH", {
        [pipeline.field]: next || null,
        _version: record._version,
      });
      await client.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
      await query.refetch();
    }
  }
  return (
    <section
      className="kanban-column"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        try {
          const r = JSON.parse(
            e.dataTransfer.getData("application/x-savia-record"),
          );
          if (r.object === object.name) void move(r.record, stage);
        } catch {}
      }}
    >
      <header>
        <strong>{label}</strong>
        <span>{query.data?.total ?? 0}</span>
      </header>
      {query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : query.isPending ? (
        <div
          className="space-y-2 py-2"
          role="status"
          aria-label={t("Cargando tarjetas…")}
        >
          <span className="sr-only">{t("Cargando tarjetas…")}</span>
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ) : (
        query.data.data.map((r: StudioRecord) => (
          <article
            className="opportunity-card"
            key={r.id}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData(
                "application/x-savia-record",
                JSON.stringify({ object: object.name, record: r }),
              )
            }
          >
            <button className="card-title" onClick={() => onOpen(r)}>
              {display(r.name ?? r[object.config.fieldOrder![0]], uiLocale)}
            </button>
            {pipeline.amountField && (
              <strong>
                {money(
                  r[pipeline.amountField],
                  String(
                    object.config.fields[pipeline.amountField]?.config
                      ?.currency || "COP",
                  ),
                  typeof object.config.fields[pipeline.amountField]?.config
                    ?.decimals === "number"
                    ? Number(
                        object.config.fields[pipeline.amountField]?.config
                          ?.decimals,
                      )
                    : object.config.fields[pipeline.amountField]?.config
                          ?.integer
                      ? 0
                      : 2,
                  uiLocale,
                )}
              </strong>
            )}
            {pipeline.ownerField && (
              <p>{display(r[pipeline.ownerField], uiLocale)}</p>
            )}
            <select
              aria-label={t("Etapa de %{p0}", { p0: String(r.name ?? r.id) })}
              value={String(r[pipeline.field] ?? "")}
              onChange={(e) => move(r, e.target.value)}
            >
              <option value="">{t("Sin etapa")}</option>
              {object.config.fields[pipeline.field].options?.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </article>
        ))
      )}
      <div className="pipeline-pages">
        <Button
          size="sm"
          variant="ghost"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          {t("Anterior")}
        </Button>
        <span>{page}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={page * 20 >= (query.data?.total ?? 0)}
          onClick={() => setPage(page + 1)}
        >
          {t("Siguiente")}
        </Button>
      </div>
    </section>
  );
}

function RelatedValue({
  objectName,
  value,
}: {
  objectName: string;
  value: unknown;
}) {
  const labelLocale = useAppLocale();
  const uiLocale = intlLocale(labelLocale);

  const ids = (Array.isArray(value) ? value : value ? [value] : []).map(String);
  const query = useQuery({
    queryKey: ["relation-labels", objectName, ids],
    queryFn: async () =>
      Promise.all(
        ids.map((id) =>
          api(`/records/${objectName}/${encodeURIComponent(id)}`)
            .then((r) =>
              display(
                r.data.name ?? r.data.title ?? r.data.subject ?? id,
                uiLocale,
              ),
            )
            .catch(() => id),
        ),
      ),
    enabled: !!ids.length,
    staleTime: 5 * 60_000,
  });
  return <>{query.data?.join(", ") ?? (ids.length ? "…" : "—")}</>;
}
