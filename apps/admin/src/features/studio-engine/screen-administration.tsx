import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import { getStudioRuntime } from "./runtime";
import { lazy, Suspense, useEffect, useState } from "react";
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
  Globe,
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
import type { StudioObject } from "@savia/studio-shared/metadata";
import type { ScreenDeletionPreview } from "@savia/studio-shared/screen-deletion";
import {
  moveMenuSectionBlock,
  moveScreenToSection,
  getMenuBlocks,
  reconcileMenuLayout,
  removeMenuSection,
  renameMenuSection,
  reorderScreensListInLayout,
  type ScreenMenuLayout,
} from "@savia/studio-shared/screen-menu-layout";
import { collectionCapabilities } from "./collection-capabilities";
import CollectionOperationsPanel from "./collection-operations-panel";
import { sortScreens } from "./screen-metadata";
import {
  pluginLookupFields,
  isPluginScreen,
  isStorePluginScreen,
  type StoreScreenInstallation,
} from "./extension-screens";
import PluginStoreManager from "./plugin-store";
import SolutionManager from "./solution-manager";
import "./screen-administration.css";

const screenDragType = "application/x-savia-screen-order";
const sectionDragType = "application/x-savia-menu-section";
export default function ScreenAdministration({
  objects,
  selected,
  detail,
  tenantTools,
  menuLayout,
  onNavigate,
  onVisibilityChange,
  onMenuLayoutChange,
  onDeletePermanent,
  onLoadDeletionPreview,
  onSolutionsChanged,
  extensions,
  defaultTab = "screens",
  tab,
  onTabChange,
}: {
  objects: StudioObject[];
  selected: string;
  detail: boolean;
  tenantTools: boolean;
  menuLayout?: ScreenMenuLayout | null;
  onNavigate: (
    name: string,
    view: string,
    extra?: Record<string, string>,
  ) => void;
  onVisibilityChange: (screen: StudioObject, hidden: boolean) => Promise<void>;
  onMenuLayoutChange: (layout: ScreenMenuLayout) => Promise<void>;
  onDeletePermanent: (
    screen: StudioObject,
    options: {
      deleteRecords: boolean;
      deleteRelated: boolean;
      deletionToken?: string;
    },
  ) => Promise<void>;
  onLoadDeletionPreview: (
    screen: StudioObject,
  ) => Promise<ScreenDeletionPreview>;
  onSolutionsChanged?: () => void | Promise<unknown>;
  extensions?: readonly StoreScreenInstallation[];
  defaultTab?: "screens" | "packages" | "extensions";
  tab?: "screens" | "packages" | "extensions";
  onTabChange?: (tab: "screens" | "packages" | "extensions") => void;
}) {
  const t = useMessages(studioMessages);
  const locale = useAppLocale();
  const [currentTab, setCurrentTab] = useState<
    "screens" | "packages" | "extensions"
  >(defaultTab);
  const [operations, setOperations] = useState(false);
  const [filter, setFilter] = useState("");
  const [pendingScreen, setPendingScreen] = useState<string | null>(null);
  const [removingScreen, setRemovingScreen] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] =
    useState<StudioObject | null>(null);
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
  const matchesScreenFilter = (item: StudioObject) =>
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
  const tenantActions = [
    {
      label: t("Pantalla desde Savia request"),
      icon: Plug,
      view: "request-page-generator",
      primary: false,
      visible: Boolean(getStudioRuntime().requestTransport),
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
      visible: tenantTools,
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
      label: t("Historial del tenant"),
      icon: History,
      view: "audit",
      primary: false,
      visible: objects.length > 0,
    },
  ].filter((action) => action.visible);
  const primaryTenantAction = tenantActions.find((action) => action.primary);
  const secondaryTenantActions = tenantActions.filter(
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
        "Fuera del menú del tenant · Accesibles mediante enlaces con permiso",
      ),
      screens: filteredInactive,
      hidden: true,
    },
  ].filter((group) => group.screens.length);
  const setScreenVisibility = async (
    target: StudioObject,
    visible: boolean,
  ) => {
    setPendingScreen(target.name);
    try {
      await onVisibilityChange(target, !visible);
      if (!visible) setRemovingScreen(null);
    } finally {
      setPendingScreen(null);
    }
  };
  const removeScreenFromMenu = async (target: StudioObject) => {
    await setScreenVisibility(target, false);
  };
  const openPermanentDelete = (target: StudioObject) => {
    setPermanentDeleteTarget(target);
  };
  const deleteScreenPermanently = async (
    target: StudioObject,
    options: {
      deleteRecords: boolean;
      deleteRelated: boolean;
      deletionToken?: string;
    },
  ) => {
    setPendingScreen(target.name);
    try {
      await onDeletePermanent(target, options);
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
  const openScreenConfig = (item: StudioObject) => {
    onNavigate(item.name, "admin-screen");
  };
  const renderCompactScreenActions = (
    item: StudioObject,
    inactive: boolean,
  ) => {
    const isPending = pendingScreen === item.name;
    const hasSource = Boolean(item.config.studio?.collection);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="screen-admin-row-mobile-actions"
            disabled={isPending}
            aria-label={t("Acciones de %{v1}", { v1: item.label })}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openScreenConfig(item)}>
            <Settings aria-hidden="true" />
            {t("Configurar")}
          </DropdownMenuItem>
          {inactive ? (
            <DropdownMenuItem
              onSelect={() => void setScreenVisibility(item, true)}
            >
              <Undo2 aria-hidden="true" />
              {t("Recuperar en el menú")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setRemovingScreen(item.name)}>
              <Trash2 aria-hidden="true" />
              {t("Eliminar del menú")}
            </DropdownMenuItem>
          )}
          {inactive ? (
            <DropdownMenuItem
              disabled={hasSource}
              variant="destructive"
              onSelect={() => openPermanentDelete(item)}
            >
              <Trash2 aria-hidden="true" />
              {t("Eliminar permanentemente")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const renderScreenRowOpen = (item: StudioObject, hasSource: boolean) => {
    const fromPlugin =
      isPluginScreen(item.name) || isStorePluginScreen(item.name, extensions);
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
  const renderActiveScreenRow = (
    item: StudioObject,
    sectionId: string | null,
  ) => {
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
            {renderCompactScreenActions(item, false)}
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
  const renderInactiveScreenRow = (item: StudioObject) => {
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
            {renderCompactScreenActions(item, true)}
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
    const runtime = getStudioRuntime();
    const isQuote = ["cotizador", "cotizador_por_pasos"].includes(screen.name);
    const canPublish =
      runtime.tenantId !== undefined &&
      runtime.publicFormTransport &&
      (isQuote ||
        (!isPluginScreen(screen.name) &&
          !isStorePluginScreen(screen.name, extensions) &&
          !screen.config.studio?.collection));
    const capabilities = collectionCapabilities(screen),
      binding = screen.config.studio?.collection,
      usesSourceFormSettings =
        !capabilities.schema && !capabilities.customFields;
    const options = [
      ...(tenantTools &&
      capabilities.schema &&
      pluginLookupFields(screen.name, extensions).length
        ? [
            {
              group: "data",
              icon: Search,
              view: "screen-lookups",
              label: t("Campos conectados"),
              description: t(
                "Busca registros de otras colecciones desde los campos del plugin.",
              ),
            },
          ]
        : []),
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
      ...(canPublish
        ? [
            {
              group: "experience",
              icon: Globe,
              view: "screen-public-link",
              label: t("Enlace público"),
              description: t(
                "Configura y comparte accesos públicos sin iniciar sesión.",
              ),
            },
          ]
        : []),
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
      ...(tenantTools
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
                : t("Colección local del tenant")}
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
        value={
          (tab ?? currentTab) === "packages"
            ? "extensions"
            : (tab ?? currentTab)
        }
        onValueChange={(val) => {
          const nextTab = val as "screens" | "packages" | "extensions";
          setCurrentTab(nextTab);
          onTabChange?.(nextTab);
        }}
        className="screen-admin-tabs w-full space-y-6"
      >
        <div className="screen-admin-tabs-nav flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-4">
          <TabsList className="bg-muted/70 p-1 rounded-xl h-auto flex-wrap">
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
              value="extensions"
              className="gap-2 px-4 py-2 text-sm font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <Plug className="size-4" aria-hidden="true" />
              <span>{t("Funcionalidades")}</span>
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
              aria-label={t("Herramientas del tenant")}
            >
              {secondaryTenantActions.length > 0 && (
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
                      {t("Herramientas del tenant")}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {secondaryTenantActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <DropdownMenuItem
                          key={action.label}
                          onSelect={() =>
                            action.extra
                              ? onNavigate(selected, action.view, action.extra)
                              : onNavigate(selected, action.view)
                          }
                        >
                          <Icon aria-hidden="true" />
                          {action.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {primaryTenantAction && (
                <Button
                  type="button"
                  size="icon"
                  aria-label={t("Nueva pantalla")}
                  title={t("Nueva pantalla")}
                  onClick={() => onNavigate(selected, primaryTenantAction.view)}
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
                    className="size-8 max-sm:size-11"
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
          value="extensions"
          className="m-0 space-y-6 focus-visible:outline-none"
        >
          <SolutionManager onChanged={onSolutionsChanged ?? (() => {})} />
          <PluginStoreManager
            hideBundledPlugins
            onChanged={onSolutionsChanged ?? (() => {})}
          />
        </TabsContent>
      </Tabs>
      {permanentDeleteTarget ? (
        <PermanentDeleteDialog
          key={permanentDeleteTarget.name}
          screen={permanentDeleteTarget}
          pending={pendingScreen === permanentDeleteTarget.name}
          onLoadPreview={onLoadDeletionPreview}
          onClose={() => setPermanentDeleteTarget(null)}
          onConfirm={(options) =>
            deleteScreenPermanently(permanentDeleteTarget, options)
          }
        />
      ) : null}
    </section>
  );
}

function PermanentDeleteDialog({
  screen,
  pending,
  onLoadPreview,
  onClose,
  onConfirm,
}: {
  screen: StudioObject;
  pending: boolean;
  onLoadPreview: (screen: StudioObject) => Promise<ScreenDeletionPreview>;
  onClose: () => void;
  onConfirm: (options: {
    deleteRecords: boolean;
    deleteRelated: boolean;
    deletionToken?: string;
  }) => Promise<void>;
}) {
  const t = useMessages(studioMessages);
  const [preview, setPreview] = useState<ScreenDeletionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [deleteRelated, setDeleteRelated] = useState(false);
  const [deleteRecordsAck, setDeleteRecordsAck] = useState(false);
  useEffect(() => {
    setDeleteRelated(false);
    setDeleteRecordsAck(false);
    setDeletionError(null);
  }, [screen.name]);
  useEffect(() => {
    let current = true;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    void onLoadPreview(screen)
      .then((result) => {
        if (current) setPreview(result);
      })
      .catch((error: unknown) => {
        if (current)
          setPreviewError(
            error instanceof Error
              ? error.message
              : t("No se pudo cargar la vista previa."),
          );
      })
      .finally(() => {
        if (current) setPreviewLoading(false);
      });
    return () => {
      current = false;
    };
  }, [onLoadPreview, retry, screen, t]);

  const hasSource = Boolean(screen.config.studio?.collection);
  const recordCount =
    preview?.screens.find((item) => item.name === screen.name)?.recordCount ??
    screen.count ??
    0;
  const scopeRecordCount = deleteRelated
    ? (preview?.totalRecords ?? recordCount)
    : recordCount;
  const hasRecords = scopeRecordCount > 0;
  const cascadeScreens =
    preview?.screens.filter((item) => item.name !== screen.name) ?? [];
  const previewScreens = preview
    ? preview.screens.some((item) => item.name === screen.name)
      ? preview.screens
      : [
          {
            name: screen.name,
            label: screen.label,
            recordCount,
            blockedReason: null,
          },
          ...preview.screens,
        ]
    : [];
  const blockedScreens =
    preview?.screens.filter((item) => item.blockedReason) ?? [];
  const rootScreen = preview?.screens.find((item) => item.name === screen.name);
  const canConfirm =
    !hasSource &&
    !previewLoading &&
    Boolean(preview) &&
    !previewError &&
    !(deleteRelated && blockedScreens.length > 0) &&
    !rootScreen?.blockedReason &&
    !(cascadeScreens.length > 0 && !deleteRelated) &&
    (!hasRecords || deleteRecordsAck);
  const confirmDelete = async () => {
    if (!preview || !canConfirm) return;
    setDeletionError(null);
    try {
      await onConfirm({
        deleteRecords: deleteRelated || hasRecords,
        deleteRelated,
        deletionToken: preview.token,
      });
    } catch (error) {
      setDeletionError(
        error instanceof Error
          ? error.message
          : t("No se pudo eliminar la pantalla."),
      );
      setDeleteRecordsAck(false);
      setRetry((value) => value + 1);
    }
  };
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
              : deleteRelated
                ? t(
                    "Se eliminarán %{v1} pantallas y %{v2} registros, incluida «%{v3}».",
                    {
                      v1: previewScreens.length,
                      v2: preview?.totalRecords ?? scopeRecordCount,
                      v3: screen.label,
                    },
                  )
                : hasRecords
                  ? t(
                      "«%{v1}» tiene %{v2} registro%{v3}. Se borrará la pantalla, su configuración y todos los datos relacionados.",
                      {
                        v1: screen.label,
                        v2: scopeRecordCount,
                        v3: scopeRecordCount === 1 ? "" : "s",
                      },
                    )
                  : t("Se borrará «%{v1}» y su configuración.", {
                      v1: screen.label,
                    })}
          </DialogDescription>
        </DialogHeader>
        {previewLoading ? (
          <p className="screen-admin-delete-status" role="status">
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            {t("Cargando vista previa de eliminación…")}
          </p>
        ) : null}
        {previewError ? (
          <div className="screen-admin-delete-error" role="alert">
            <p>
              {t("No se pudo cargar la vista previa.")} {previewError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Reintentar")}
            </Button>
          </div>
        ) : null}
        {deletionError ? (
          <p className="screen-admin-delete-error" role="alert">
            {t(
              "La eliminación no se confirmó. Revisa la vista previa y confirma de nuevo.",
            )}{" "}
            {deletionError}
          </p>
        ) : null}
        {preview && !hasSource ? (
          <div className="screen-admin-delete-preview">
            <p className="screen-admin-delete-preview-title">
              {deleteRelated
                ? t("Se eliminarán estas pantallas y sus registros:")
                : t(
                    "Pantalla seleccionada y pantallas dependientes detectadas:",
                  )}
            </p>
            <ul aria-label={t("Pantallas incluidas en la eliminación")}>
              {previewScreens.map((item) => (
                <li key={item.name}>
                  <span>
                    <strong>{item.label}</strong>
                    <code>{item.name}</code>
                  </span>
                  <span>
                    {item.recordCount} {t("registros")}
                  </span>
                  {item.blockedReason ? (
                    <span className="screen-admin-delete-block-reason">
                      {item.blockedReason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {preview && !hasSource ? (
          <label className="screen-admin-delete-cascade">
            <Checkbox
              checked={deleteRelated}
              disabled={pending || previewLoading}
              onCheckedChange={(checked) => {
                setDeleteRelated(checked === true);
                setDeleteRecordsAck(false);
                setDeletionError(null);
              }}
            />
            <span>
              {t("Eliminar también las pantallas dependientes y sus datos")}
            </span>
          </label>
        ) : null}
        {preview && cascadeScreens.length > 0 && !deleteRelated ? (
          <p className="screen-admin-delete-dependents">
            {t(
              "Hay pantallas dependientes. Elimina sus relaciones primero o activa la opción para eliminarlas también.",
            )}
          </p>
        ) : null}
        {preview && rootScreen?.blockedReason ? (
          <p className="screen-admin-delete-error" role="alert">
            <strong>{screen.label}</strong> <code>{screen.name}</code>:{" "}
            {rootScreen.blockedReason}
          </p>
        ) : null}
        {preview && deleteRelated && blockedScreens.length > 0 ? (
          <div className="screen-admin-delete-error" role="alert">
            <p>
              {t(
                "No se puede eliminar la cascada mientras haya pantallas dependientes protegidas o externas.",
              )}
            </p>
            <ul>
              {blockedScreens.map((item) => (
                <li key={item.name}>
                  <strong>{item.label}</strong> <code>{item.name}</code>:{" "}
                  {item.blockedReason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasRecords && !hasSource ? (
          <label className="screen-admin-delete-ack">
            <Checkbox
              checked={deleteRecordsAck}
              disabled={pending || previewLoading || !preview}
              onCheckedChange={(checked) =>
                setDeleteRecordsAck(checked === true)
              }
            />
            <span>
              {t("Entiendo que también se eliminarán")} {scopeRecordCount}{" "}
              {t("registro")}
              {scopeRecordCount === 1 ? "" : "s"} {t("y no se puede deshacer")}
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
            onClick={() => void confirmDelete()}
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
