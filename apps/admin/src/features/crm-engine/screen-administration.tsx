import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import { getCrmRuntime } from "./runtime";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowDownAZ,
  Boxes,
  ChevronRight,
  Database,
  Eye,
  FormInput,
  GripVertical,
  History,
  LayoutDashboard,
  LoaderCircle,
  MoreHorizontal,
  Network,
  PanelTop,
  Plus,
  Plug,
  Search,
  Settings,
  SlidersHorizontal,
  KeyRound,
  Trash2,
  Undo2,
  FileSpreadsheet,
} from "lucide-react";
import type { CrmObject } from "@savia/crm-shared/metadata";
import {
  moveMenuSectionBlock,
  moveScreenToSection,
  getMenuBlocks,
  reconcileMenuLayout,
  removeMenuSection,
  renameMenuSection,
  reorderScreensListInLayout,
  type ScreenMenuLayout,
} from "@savia/crm-shared/screen-menu-layout";
import { collectionCapabilities } from "./collection-capabilities";
import CollectionOperationsPanel from "./collection-operations-panel";
import { sortScreens } from "./screen-metadata";
import { isPluginScreen } from "./extension-screens";
import ExtensionManager from "./extension-manager";
import SolutionManager from "./solution-manager";
import "./screen-administration.css";

const PublicLinkManager = lazy(() =>
  import("../public-forms/public-link-manager").then((module) => ({
    default: module.PublicLinkManager,
  })),
);

const screenDragType = "application/x-savia-screen-order";
const sectionDragType = "application/x-savia-menu-section";
export default function ScreenAdministration({
  objects,
  selected,
  detail,
  domainTools,
  menuLayout,
  onNavigate,
  onVisibilityChange,
  onMenuLayoutChange,
  onDeletePermanent,
  onSolutionsChanged,
  defaultTab = "screens",
  tab,
  onTabChange,
}: {
  objects: CrmObject[];
  selected: string;
  detail: boolean;
  domainTools: boolean;
  menuLayout?: ScreenMenuLayout | null;
  onNavigate: (
    name: string,
    view: string,
    extra?: Record<string, string>,
  ) => void;
  onVisibilityChange: (screen: CrmObject, hidden: boolean) => Promise<void>;
  onMenuLayoutChange: (layout: ScreenMenuLayout) => Promise<void>;
  onDeletePermanent: (
    screen: CrmObject,
    options: { deleteRecords: boolean },
  ) => Promise<void>;
  onSolutionsChanged?: () => void | Promise<unknown>;
  defaultTab?: "screens" | "packages";
  tab?: "screens" | "packages";
  onTabChange?: (tab: "screens" | "packages") => void;
}) {
  const t = useMessages(studioMessages);
  const locale = useAppLocale();
  const [currentTab, setCurrentTab] = useState<"screens" | "packages">(
    defaultTab,
  );
  const [operations, setOperations] = useState(false);
  const [publicLinks, setPublicLinks] = useState(false);
  const [filter, setFilter] = useState("");
  const [pendingScreen, setPendingScreen] = useState<string | null>(null);
  const [removingScreen, setRemovingScreen] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] =
    useState<CrmObject | null>(null);
  const [deleteRecordsAck, setDeleteRecordsAck] = useState(false);
  const [draggingScreen, setDraggingScreen] = useState<string | null>(null);
  const [dropTargetScreen, setDropTargetScreen] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<string | null>(null);
  const [dropTargetSection, setDropTargetSection] = useState<string | null>(
    null,
  );
  const active = sortScreens(
    objects.filter((o) => !o.config.studio?.screen?.hidden),
    intlLocale(locale),
  );
  const activeLayout = reconcileMenuLayout(
    menuLayout,
    active.map((screen) => screen.name),
  );
  const activeBlocks = getMenuBlocks(activeLayout);
  const screensByName = new Map(active.map((screen) => [screen.name, screen]));
  const inactive = sortScreens(
    objects.filter((o) => o.config.studio?.screen?.hidden),
    intlLocale(locale),
  );
  const normalizedFilter = filter.trim().toLocaleLowerCase(intlLocale(locale));
  const matchesScreenFilter = (item: CrmObject) =>
    !normalizedFilter ||
    item.label.toLocaleLowerCase(intlLocale(locale)).includes(normalizedFilter);
  const filteredActive = active.filter(matchesScreenFilter);
  const filteredInactive = inactive.filter(matchesScreenFilter);
  const filteredActiveBlocks = normalizedFilter
    ? activeBlocks
        .map((block) => ({
          ...block,
          screens: block.screens.filter((screenName) => {
            const screen = screensByName.get(screenName);
            return screen ? matchesScreenFilter(screen) : false;
          }),
        }))
        .filter((block) => block.screens.length)
    : activeBlocks;
  const screen = objects.find((o) => o.name === selected);
  const domainActions = [
    {
      label: t("Pantalla desde Savia request"),
      icon: Plug,
      view: "request-page-generator",
      primary: false,
      visible: Boolean(getCrmRuntime().requestTransport),
    },
    {
      label: t("Nueva pantalla"),
      icon: Plus,
      view: "new-object",
      primary: true,
      visible: true,
    },
    {
      label: t("Desde Excel o CSV"),
      icon: FileSpreadsheet,
      view: "import-spreadsheet",
      primary: false,
      visible: true,
    },
    {
      label: t("Gestionar pantallas"),
      icon: LayoutDashboard,
      view: "screens",
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: t("Fuentes de datos"),
      icon: Database,
      view: "collection-sources",
      primary: false,
      visible: domainTools,
    },
    {
      label: t("Integraciones y API"),
      icon: Plug,
      view: "collection-sources",
      extra: { tab: "integrations" },
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: t("Claves y servicios"),
      icon: KeyRound,
      view: "service-credentials",
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: t("Reportes y acciones"),
      icon: SlidersHorizontal,
      view: "operations",
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: t("Historial del dominio"),
      icon: History,
      view: "audit",
      primary: false,
      visible: objects.length > 0,
    },
  ].filter((action) => action.visible);
  const primaryDomainAction = domainActions.find((action) => action.primary);
  const secondaryDomainActions = domainActions.filter(
    (action) => !action.primary,
  );
  const screenGroups = [
    {
      id: "active",
      label: t("Pantallas disponibles"),
      subtitle: t("Disponibles para el menú según tus permisos y preferencias"),
      screens: filteredActive,
      hidden: false,
    },
    {
      id: "inactive",
      label: t("Pantallas fuera del menú"),
      subtitle: t(
        "Fuera del menú del dominio · Accesibles mediante enlaces con permiso",
      ),
      screens: filteredInactive,
      hidden: true,
    },
  ].filter((group) => group.screens.length);
  const setScreenVisibility = async (target: CrmObject, visible: boolean) => {
    setPendingScreen(target.name);
    try {
      await onVisibilityChange(target, !visible);
      if (!visible) setRemovingScreen(null);
    } finally {
      setPendingScreen(null);
    }
  };
  const removeScreenFromMenu = async (target: CrmObject) => {
    await setScreenVisibility(target, false);
  };
  const openPermanentDelete = (target: CrmObject) => {
    setDeleteRecordsAck(false);
    setPermanentDeleteTarget(target);
  };
  const deleteScreenPermanently = async (target: CrmObject) => {
    const recordCount = target.count ?? 0;
    setPendingScreen(target.name);
    try {
      await onDeletePermanent(target, {
        deleteRecords: recordCount > 0,
      });
      setPermanentDeleteTarget(null);
      setRemovingScreen(null);
    } finally {
      setPendingScreen(null);
    }
  };
  const finishScreenDrag = () => {
    setDraggingScreen(null);
    setDropTargetScreen(null);
    setDraggingSection(null);
    setDropTargetSection(null);
  };
  const persistMenuLayout = async (next: ScreenMenuLayout) => {
    setPendingScreen("__menu__");
    try {
      await onMenuLayoutChange(next);
    } finally {
      setPendingScreen(null);
      finishScreenDrag();
      setDraggingSection(null);
      setDropTargetSection(null);
    }
  };
  const sortMenuAlphabetically = () => {
    const compareScreenNames = (leftName: string, rightName: string) => {
      const left = screensByName.get(leftName);
      const right = screensByName.get(rightName);
      const labelOrder = (left?.label ?? leftName).localeCompare(
        right?.label ?? rightName,
        intlLocale(locale),
      );
      return (
        labelOrder || leftName.localeCompare(rightName, intlLocale(locale))
      );
    };
    void persistMenuLayout({
      version: 1,
      blocks: activeLayout.blocks.map((block) => ({
        ...block,
        screens: [...block.screens].sort(compareScreenNames),
      })),
    });
  };
  const handleScreenDrop = async (
    sourceName: string,
    target:
      | { kind: "screen"; beforeName: string }
      | { kind: "section"; sectionId: string | null }
      | { kind: "end" },
  ) => {
    if (!sourceName) {
      finishScreenDrag();
      return;
    }
    let next = activeLayout;
    if (target.kind === "end") {
      next = reorderScreensListInLayout(activeLayout, sourceName);
    } else if (target.kind === "section") {
      next = moveScreenToSection(activeLayout, sourceName, target.sectionId);
    } else if (sourceName !== target.beforeName) {
      next = reorderScreensListInLayout(
        activeLayout,
        sourceName,
        target.beforeName,
      );
    }
    await persistMenuLayout(next);
  };
  const handleSectionDrop = async (
    sourceSectionId: string,
    beforeSectionId?: string,
  ) => {
    if (!sourceSectionId || sourceSectionId === beforeSectionId) {
      finishScreenDrag();
      return;
    }
    await persistMenuLayout(
      moveMenuSectionBlock(activeLayout, sourceSectionId, beforeSectionId),
    );
  };
  const openScreenConfig = (item: CrmObject) => {
    onNavigate(item.name, "admin-screen");
  };
  const renderScreenRowOpen = (item: CrmObject, hasSource: boolean) => {
    const fromPlugin = isPluginScreen(item.name);
    return (
      <button
        type="button"
        className="screen-admin-row-open"
        aria-label={t("Configurar %{v1}", { v1: item.label })}
        onClick={() => openScreenConfig(item)}
      >
        <span className="screen-admin-row-icon" aria-hidden="true">
          {hasSource ? (
            <Database />
          ) : fromPlugin ? (
            <Plug />
          ) : (
            <LayoutDashboard />
          )}
        </span>
        <span className="screen-admin-row-copy">
          <span className="screen-admin-row-title-wrap">
            <span className="screen-admin-row-title">{item.label}</span>
            {fromPlugin ? (
              <span className="screen-admin-plugin-badge">{t("Plugin")}</span>
            ) : null}
          </span>
          <span className="screen-admin-row-meta">
            {hasSource
              ? t("Conectada a una fuente de datos")
              : fromPlugin
                ? t("Pantalla provista por plugin / extensión")
                : t("Colección local")}
          </span>
        </span>
      </button>
    );
  };
  const renderActiveScreenRow = (item: CrmObject, sectionId: string | null) => {
    const hasSource = Boolean(item.config.studio?.collection);
    const isPending =
      pendingScreen === item.name || pendingScreen === "__menu__";
    const isDragging = draggingScreen === item.name;
    const isDropTarget = dropTargetScreen === item.name;
    return (
      <div key={item.name} className="screen-admin-row-group">
        <article
          className={`screen-admin-row${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (draggingScreen && draggingScreen !== item.name)
              setDropTargetScreen(item.name);
          }}
          onDragLeave={() => {
            if (dropTargetScreen === item.name) setDropTargetScreen(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const sourceName = event.dataTransfer.getData(screenDragType);
            if (!sourceName) return;
            if (sectionId) {
              void handleScreenDrop(sourceName, {
                kind: "section",
                sectionId,
              });
              return;
            }
            void handleScreenDrop(sourceName, {
              kind: "screen",
              beforeName: item.name,
            });
          }}
        >
          <button
            type="button"
            className="screen-admin-row-drag"
            draggable={!isPending}
            aria-label={t("Reordenar %{v1}", { v1: item.label })}
            onDragStart={(event) => {
              event.dataTransfer.setData(screenDragType, item.name);
              event.dataTransfer.effectAllowed = "move";
              setDraggingScreen(item.name);
            }}
            onDragEnd={finishScreenDrag}
          >
            <GripVertical aria-hidden="true" />
          </button>
          {renderScreenRowOpen(item, hasSource)}
          <div className="screen-admin-row-actions">
            <span className="screen-admin-row-visibility">
              <Switch
                aria-label={t("Desactivar %{v1}", { v1: item.label })}
                title={t("Mostrar u ocultar en la barra lateral")}
                checked
                disabled={isPending}
                onCheckedChange={(visible) => {
                  void setScreenVisibility(item, visible);
                }}
              />
              <span>{t("Activa")}</span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  className="screen-admin-row-delete"
                  aria-label={t("Eliminar pantalla %{v1}", { v1: item.label })}
                  onClick={() => setRemovingScreen(item.name)}
                >
                  {isPending ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                {t("Eliminar del menú")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("Configurar %{v1}", { v1: item.label })}
                  onClick={() => openScreenConfig(item)}
                >
                  <Settings aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                {t("Configurar")}
              </TooltipContent>
            </Tooltip>
          </div>
        </article>
        {removingScreen === item.name ? (
          <div className="screen-admin-removal">
            <p>
              {t("¿Eliminar «")}
              {item.label}
              {t("» del menú? Los registros se conservarán.")}
            </p>
            <div className="screen-admin-removal-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => setRemovingScreen(null)}
              >
                {t("Cancelar")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={() => void removeScreenFromMenu(item)}
              >
                {t("Eliminar del menú")}
              </Button>
              {!hasSource ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  className="screen-admin-row-delete-permanent"
                  onClick={() => {
                    setRemovingScreen(null);
                    openPermanentDelete(item);
                  }}
                >
                  {t("Eliminar permanentemente")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };
  const renderInactiveScreenRow = (item: CrmObject) => {
    const hasSource = Boolean(item.config.studio?.collection);
    const isPending = pendingScreen === item.name;
    return (
      <div key={item.name} className="screen-admin-row-group">
        <article className="screen-admin-row is-inactive">
          <span className="screen-admin-row-drag-spacer" />
          {renderScreenRowOpen(item, hasSource)}
          <div className="screen-admin-row-actions">
            <span className="screen-admin-row-visibility">
              <Switch
                aria-label={t("Activar %{v1}", { v1: item.label })}
                title={t("Mostrar u ocultar en la barra lateral")}
                checked={false}
                disabled={isPending}
                onCheckedChange={(visible) => {
                  void setScreenVisibility(item, visible);
                }}
              />
              <span>{t("Inactiva")}</span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  aria-label={t("Recuperar pantalla %{v1}", { v1: item.label })}
                  onClick={() => void setScreenVisibility(item, true)}
                >
                  {isPending ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Undo2 aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                {t("Recuperar en el menú")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending || hasSource}
                  className="screen-admin-row-delete-permanent"
                  aria-label={t("Eliminar permanentemente %{v1}", {
                    v1: item.label,
                  })}
                  onClick={() => openPermanentDelete(item)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                {hasSource
                  ? t("Desvincula la fuente antes de eliminar")
                  : t("Eliminar permanentemente")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("Configurar %{v1}", { v1: item.label })}
                  onClick={() => openScreenConfig(item)}
                >
                  <Settings aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                {t("Configurar")}
              </TooltipContent>
            </Tooltip>
          </div>
        </article>
      </div>
    );
  };
  if (detail && screen) {
    const runtime = getCrmRuntime();
    const isQuote = ["cotizador", "cotizador_por_pasos"].includes(screen.name);
    const canPublish =
      runtime.domainId &&
      runtime.publicFormTransport &&
      (isQuote ||
        (!isPluginScreen(screen.name) && !screen.config.studio?.collection));
    const capabilities = collectionCapabilities(screen),
      binding = screen.config.studio?.collection,
      usesSourceFormSettings =
        !capabilities.schema && !capabilities.customFields;
    const options = [
      {
        group: "experience",
        icon: Eye,
        view: "records",
        label: t("Ver pantalla"),
        description: t("Abre los registros de esta pantalla."),
      },
      {
        group: "experience",
        icon: FormInput,
        view: usesSourceFormSettings ? "records" : "designer",
        extra: usesSourceFormSettings ? { configure: "form" } : undefined,
        label: t("Campos y formulario"),
        description: usesSourceFormSettings
          ? t("Configura la tabla y la distribución del formulario.")
          : t("Configura las etiquetas, los campos y el formulario."),
      },
      {
        group: "experience",
        icon: PanelTop,
        view: "screen-settings",
        label: t("Presentación y menú"),
        description: t(
          "Elige cómo se abren crear y editar, y la visibilidad en el menú.",
        ),
      },
      ...(binding
        ? [
            {
              group: "data",
              icon: Database,
              view: "screen-operations",
              label: t("Operaciones del API"),
              description: t(
                "Elige los endpoints y mapeos para listar, crear, editar y eliminar.",
              ),
            },
          ]
        : []),
      ...(domainTools
        ? [
            {
              group: "data",
              icon: Network,
              view: "screen-relations",
              label: t("Relaciones"),
              description: t(
                "Consulta y configura las conexiones de esta pantalla.",
              ),
            },
          ]
        : []),
      {
        group: "tracking",
        icon: History,
        view: "screen-audit",
        label: t("Historial de cambios"),
        description: t("Consulta los cambios registrados para esta pantalla."),
      },
    ].filter((o) => o.view !== "records" || capabilities.read);
    const optionGroups = [
      { id: "experience", label: t("Experiencia") },
      { id: "data", label: t("Datos y conexiones") },
      { id: "tracking", label: t("Seguimiento") },
    ]
      .map((group) => ({
        ...group,
        options: options.filter((option) => option.group === group.id),
      }))
      .filter((group) => group.options.length);
    return (
      <section
        aria-label={t("Configurar %{v1}", { v1: screen.label })}
        className="screen-admin"
      >
        <header className="screen-admin-detail-header">
          <h1>{screen.label}</h1>
          <p className="screen-admin-source">
            <Database aria-hidden="true" />
            <span>
              {binding
                ? `${binding.domain ?? binding.sourceId} · ${binding.resource}`
                : t("Colección local del dominio")}
            </span>
          </p>
        </header>
        <div className="screen-admin-options savia-surface-card">
          {optionGroups.map((group) => (
            <section
              key={group.id}
              className="screen-admin-option-group"
              aria-label={group.label}
            >
              <h2>{group.label}</h2>
              <div className="screen-admin-option-list">
                {group.options.map((option) => {
                  const Icon = option.icon;
                  return (
                    <Tooltip key={option.view}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          className="screen-admin-option-row"
                          aria-label={t("%{v1} de %{v2}", {
                            v1: option.label,
                            v2: screen.label,
                          })}
                          onClick={() => {
                            if (option.view === "screen-operations") {
                              setOperations(true);
                              return;
                            }
                            if (option.extra)
                              onNavigate(
                                screen.name,
                                option.view,
                                option.extra,
                              );
                            else onNavigate(screen.name, option.view);
                          }}
                        >
                          <span className="screen-admin-option-icon">
                            <Icon aria-hidden="true" />
                          </span>
                          <span className="screen-admin-option-copy">
                            <span className="screen-admin-option-title">
                              {option.label}
                            </span>
                            <span className="screen-admin-option-description">
                              {option.description}
                            </span>
                          </span>
                          <ChevronRight
                            className="screen-admin-option-chevron"
                            aria-hidden="true"
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" sideOffset={6}>
                        {t("Abrir")} {option.label}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {canPublish && (
          <section aria-label={t("Acceso público")}>
            <Button
              type="button"
              variant="outline"
              aria-expanded={publicLinks}
              onClick={() => setPublicLinks(!publicLinks)}
            >
              {publicLinks
                ? t("Ocultar enlaces públicos")
                : t("Enlaces públicos")}
            </Button>
            {publicLinks && (
              <Suspense
                fallback={<p role="status">{t("Cargando enlaces…")}</p>}
              >
                <PublicLinkManager
                  key={`${runtime.domainId}:${screen.name}`}
                  domainId={runtime.domainId!}
                  objectName={screen.name}
                  kind={isQuote ? "quote" : "record"}
                  request={runtime.publicFormTransport!}
                />
              </Suspense>
            )}
          </section>
        )}
        {operations && (
          <CollectionOperationsPanel
            name={screen.name}
            label={screen.label}
            onClose={() => setOperations(false)}
          />
        )}
      </section>
    );
  }
  return (
    <section aria-label={t("Administrar pantallas")} className="screen-admin">
      <Tabs
        value={tab ?? currentTab}
        onValueChange={(val) => {
          const nextTab = val as "screens" | "packages";
          setCurrentTab(nextTab);
          onTabChange?.(nextTab);
        }}
        className="screen-admin-tabs w-full space-y-6"
      >
        <div className="screen-admin-tabs-nav flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-4">
          <TabsList className="bg-muted/70 p-1 rounded-xl h-11">
            <TabsTrigger
              value="screens"
              className="gap-2 px-4 py-2 text-sm font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span>{t("Pantallas")}</span>
              {active.length > 0 && (
                <span className="screen-admin-count text-xs" aria-hidden="true">
                  {active.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="packages"
              className="gap-2 px-4 py-2 text-sm font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <Boxes className="size-4" aria-hidden="true" />
              <span>{t("Paquetes y extensiones")}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="screens"
          className="m-0 space-y-6 focus-visible:outline-none"
        >
          <header className="screen-admin-overview">
            <div className="screen-admin-overview-copy">
              <div className="screen-admin-title-row">
                <h1>{t("Pantallas")}</h1>
                {active.length > 0 && (
                  <span className="screen-admin-count">
                    {active.length} {t("disponibles")}
                  </span>
                )}
              </div>
            </div>
            <div
              className="screen-admin-actions"
              aria-label={t("Herramientas del dominio")}
            >
              {secondaryDomainActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("Más herramientas")}
                      title={t("Más herramientas")}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      {t("Herramientas del dominio")}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {secondaryDomainActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <DropdownMenuItem
                          key={action.view}
                          onSelect={() => onNavigate(selected, action.view)}
                        >
                          <Icon aria-hidden="true" />
                          {action.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {primaryDomainAction && (
                <Button
                  type="button"
                  size="icon"
                  aria-label={t("Nueva pantalla")}
                  title={t("Nueva pantalla")}
                  onClick={() => onNavigate(selected, primaryDomainAction.view)}
                >
                  <Plus aria-hidden="true" />
                </Button>
              )}
            </div>
          </header>
          <section
            className="screen-admin-list savia-surface-card"
            aria-label={t("Pantallas")}
          >
            <div className="screen-admin-screen-toolbar">
              <div className="screen-admin-menu-filter">
                <Search aria-hidden="true" />
                <Input
                  type="search"
                  aria-label={t("Filtrar pantallas")}
                  placeholder={t("Filtrar pantallas")}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={t("Ordenar pantallas de A a Z")}
                    disabled={pendingScreen === "__menu__"}
                    onClick={sortMenuAlphabetically}
                  >
                    <ArrowDownAZ aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={6}>
                  {t("Ordenar pantallas de A a Z")}
                </TooltipContent>
              </Tooltip>
            </div>
            {screenGroups.length ? (
              screenGroups.map((group) => (
                <section
                  key={group.id}
                  className="screen-admin-screen-group"
                  aria-label={group.label}
                >
                  <header className="screen-admin-list-heading">
                    <div>
                      <h2>{group.label}</h2>
                      {group.subtitle ? (
                        <p className="screen-admin-list-subheading">
                          {group.subtitle}
                        </p>
                      ) : null}
                    </div>
                    <span>{group.screens.length}</span>
                  </header>
                  {group.id === "active" ? (
                    <>
                      {filteredActiveBlocks.map((block) =>
                        block.kind === "section" ? (
                          <div
                            key={block.id}
                            className={`screen-admin-menu-section${dropTargetSection === block.id ? " is-drop-target" : ""}${draggingSection === block.id ? " is-dragging" : ""}`}
                            onDragOver={(event) => {
                              event.preventDefault();
                              if (draggingScreen)
                                setDropTargetSection(block.id);
                            }}
                            onDragLeave={() => {
                              if (dropTargetSection === block.id)
                                setDropTargetSection(null);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const sourceName =
                                event.dataTransfer.getData(screenDragType);
                              if (sourceName) {
                                void handleScreenDrop(sourceName, {
                                  kind: "section",
                                  sectionId: block.id,
                                });
                                return;
                              }
                              const sourceSection =
                                event.dataTransfer.getData(sectionDragType);
                              void handleSectionDrop(sourceSection, block.id);
                            }}
                          >
                            <header className="screen-admin-menu-section-header">
                              <button
                                type="button"
                                className="screen-admin-row-drag"
                                draggable={pendingScreen !== "__menu__"}
                                aria-label={t("Reordenar sección %{v1}", {
                                  v1: block.label,
                                })}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData(
                                    sectionDragType,
                                    block.id,
                                  );
                                  event.dataTransfer.effectAllowed = "move";
                                  setDraggingSection(block.id);
                                }}
                                onDragEnd={finishScreenDrag}
                              >
                                <GripVertical aria-hidden="true" />
                              </button>
                              <Input
                                className="screen-admin-menu-section-label"
                                aria-label={t("Nombre de la sección %{v1}", {
                                  v1: block.label,
                                })}
                                defaultValue={block.label}
                                disabled={pendingScreen === "__menu__"}
                                onBlur={(event) => {
                                  const label = event.target.value.trim();
                                  if (!label || label === block.label) return;
                                  void persistMenuLayout(
                                    renameMenuSection(
                                      activeLayout,
                                      block.id,
                                      label,
                                    ),
                                  );
                                }}
                              />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    disabled={pendingScreen === "__menu__"}
                                    aria-label={t("Eliminar sección %{v1}", {
                                      v1: block.label,
                                    })}
                                    onClick={() =>
                                      void persistMenuLayout(
                                        removeMenuSection(
                                          activeLayout,
                                          block.id,
                                        ),
                                      )
                                    }
                                  >
                                    <Trash2 aria-hidden="true" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left" sideOffset={6}>
                                  {t("Eliminar sección")}
                                </TooltipContent>
                              </Tooltip>
                            </header>
                            {block.screens.map((screenName) => {
                              const item = screensByName.get(screenName);
                              return item
                                ? renderActiveScreenRow(item, block.id)
                                : null;
                            })}
                          </div>
                        ) : (
                          block.screens.map((screenName) => {
                            const item = screensByName.get(screenName);
                            return item
                              ? renderActiveScreenRow(item, null)
                              : null;
                          })
                        ),
                      )}
                      {filteredActive.length > 1 ? (
                        <div
                          className={`screen-admin-drop-end${draggingScreen ? " is-visible" : ""}${dropTargetScreen === "__end__" ? " is-drop-target" : ""}`}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (draggingScreen) setDropTargetScreen("__end__");
                          }}
                          onDragLeave={() => {
                            if (dropTargetScreen === "__end__")
                              setDropTargetScreen(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const sourceName =
                              event.dataTransfer.getData(screenDragType);
                            void handleScreenDrop(sourceName, { kind: "end" });
                          }}
                        >
                          {t("Suelta aquí para mover al final")}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    group.screens.map((item) => renderInactiveScreenRow(item))
                  )}
                </section>
              ))
            ) : normalizedFilter ? (
              <div className="screen-admin-empty screen-admin-filter-empty">
                <Search
                  className="screen-admin-empty-icon"
                  aria-hidden="true"
                />
                <div>
                  <h2>{t("No se encontraron pantallas")}</h2>
                  <p>{t("Prueba con otro nombre o limpia el filtro.")}</p>
                </div>
              </div>
            ) : (
              <div className="screen-admin-empty">
                <LayoutDashboard
                  className="screen-admin-empty-icon"
                  aria-hidden="true"
                />
                <div>
                  <h2>{t("Aún no tienes pantallas")}</h2>
                  <p>
                    {t(
                      "Crea la primera para definir sus datos, diseño y operaciones.",
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => onNavigate(selected, "new-object")}
                >
                  <Plus aria-hidden="true" />
                  {t("Crear pantalla")}
                </Button>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent
          value="packages"
          className="m-0 focus-visible:outline-none"
        >
          <div className="space-y-6">
            <SolutionManager onChanged={onSolutionsChanged ?? (() => {})} />
            <ExtensionManager onChanged={onSolutionsChanged ?? (() => {})} />
          </div>
        </TabsContent>
      </Tabs>
      {permanentDeleteTarget ? (
        <PermanentDeleteDialog
          screen={permanentDeleteTarget}
          pending={pendingScreen === permanentDeleteTarget.name}
          deleteRecordsAck={deleteRecordsAck}
          onDeleteRecordsAckChange={setDeleteRecordsAck}
          onClose={() => setPermanentDeleteTarget(null)}
          onConfirm={() => void deleteScreenPermanently(permanentDeleteTarget)}
        />
      ) : null}
    </section>
  );
}

function PermanentDeleteDialog({
  screen,
  pending,
  deleteRecordsAck,
  onDeleteRecordsAckChange,
  onClose,
  onConfirm,
}: {
  screen: CrmObject;
  pending: boolean;
  deleteRecordsAck: boolean;
  onDeleteRecordsAckChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useMessages(studioMessages);
  const hasSource = Boolean(screen.config.studio?.collection);
  const recordCount = screen.count ?? 0;
  const hasRecords = recordCount > 0;
  const canConfirm = !hasSource && (!hasRecords || deleteRecordsAck);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="screen-admin-delete-dialog">
        <DialogHeader>
          <DialogTitle>{t("Eliminar pantalla permanentemente")}</DialogTitle>
          <DialogDescription>
            {hasSource
              ? t(
                  "Desvincula la fuente de datos antes de eliminar esta pantalla.",
                )
              : hasRecords
                ? t(
                    "«%{v1}» tiene %{v2} registro%{v3}. Se borrará la pantalla, su configuración y todos los datos relacionados.",
                    {
                      v1: screen.label,
                      v2: recordCount,
                      v3: recordCount === 1 ? "" : "s",
                    },
                  )
                : t("Se borrará «%{v1}» y su configuración.", {
                    v1: screen.label,
                  })}
          </DialogDescription>
        </DialogHeader>
        {hasRecords && !hasSource ? (
          <label className="screen-admin-delete-ack">
            <Checkbox
              checked={deleteRecordsAck}
              disabled={pending}
              onCheckedChange={(checked) =>
                onDeleteRecordsAckChange(checked === true)
              }
            />
            <span>
              {t("Entiendo que también se eliminarán")} {recordCount}{" "}
              {t("registro")}
              {recordCount === 1 ? "" : "s"} {t("y no se puede deshacer")}
            </span>
          </label>
        ) : null}
        <p className="screen-admin-delete-warning">
          {t("Esta acción no se puede deshacer.")}
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            {t("Cancelar")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || !canConfirm}
            onClick={onConfirm}
          >
            {pending ? (
              <>
                <LoaderCircle className="animate-spin" aria-hidden="true" />
                {t("Eliminando…")}
              </>
            ) : (
              t("Eliminar permanentemente")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
