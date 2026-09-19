import { getCrmRuntime } from "./runtime";
import { useState } from "react";
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
}) {
  const [currentTab, setCurrentTab] = useState<"screens" | "packages">(
    defaultTab,
  );
  const [operations, setOperations] = useState(false);
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
  );
  const activeLayout = reconcileMenuLayout(
    menuLayout,
    active.map((screen) => screen.name),
  );
  const activeBlocks = getMenuBlocks(activeLayout);
  const screensByName = new Map(active.map((screen) => [screen.name, screen]));
  const inactive = sortScreens(
    objects.filter((o) => o.config.studio?.screen?.hidden),
  );
  const normalizedFilter = filter.trim().toLocaleLowerCase("es");
  const matchesScreenFilter = (item: CrmObject) =>
    !normalizedFilter ||
    item.label.toLocaleLowerCase("es").includes(normalizedFilter);
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
      label: "Página desde Savia request",
      icon: Plug,
      view: "request-page-generator",
      primary: false,
      visible: Boolean(getCrmRuntime().requestTransport),
    },
    {
      label: "Nueva pantalla",
      icon: Plus,
      view: "new-object",
      primary: true,
      visible: true,
    },
    {
      label: "Desde Excel o CSV",
      icon: FileSpreadsheet,
      view: "import-spreadsheet",
      primary: false,
      visible: true,
    },
    {
      label: "Gestionar pantallas",
      icon: LayoutDashboard,
      view: "screens",
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: "Fuentes de datos",
      icon: Database,
      view: "collection-sources",
      primary: false,
      visible: domainTools,
    },
    {
      label: "Integraciones y API",
      icon: Plug,
      view: "integrations",
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: "Claves y servicios",
      icon: KeyRound,
      view: "service-credentials",
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: "Reportes y acciones",
      icon: SlidersHorizontal,
      view: "operations",
      primary: false,
      visible: objects.length > 0,
    },
    {
      label: "Historial del dominio",
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
      label: "Pantallas activas",
      subtitle: "Visibles en la barra lateral",
      screens: filteredActive,
      hidden: false,
    },
    {
      id: "inactive",
      label: "Pantallas inactivas",
      subtitle: "Ocultas de la barra lateral · Accesibles desde otras páginas",
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
        "es",
      );
      return labelOrder || leftName.localeCompare(rightName, "es");
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
        aria-label={`Configurar ${item.label}`}
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
              <span className="screen-admin-plugin-badge">Plugin</span>
            ) : null}
          </span>
          <span className="screen-admin-row-meta">
            {hasSource
              ? "Conectada a una fuente de datos"
              : fromPlugin
                ? "Pantalla provista por plugin / extensión"
                : "Colección local"}
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
            aria-label={`Reordenar ${item.label}`}
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
                aria-label={`Desactivar ${item.label}`}
                title="Mostrar u ocultar en la barra lateral"
                checked
                disabled={isPending}
                onCheckedChange={(visible) => {
                  void setScreenVisibility(item, visible);
                }}
              />
              <span>Activa</span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  className="screen-admin-row-delete"
                  aria-label={`Eliminar pantalla ${item.label}`}
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
                Eliminar del menú
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Configurar ${item.label}`}
                  onClick={() => openScreenConfig(item)}
                >
                  <Settings aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                Configurar
              </TooltipContent>
            </Tooltip>
          </div>
        </article>
        {removingScreen === item.name ? (
          <div className="screen-admin-removal">
            <p>
              ¿Eliminar «{item.label}» del menú? Los registros se conservarán.
            </p>
            <div className="screen-admin-removal-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => setRemovingScreen(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={() => void removeScreenFromMenu(item)}
              >
                Eliminar del menú
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
                  Eliminar permanentemente
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
                aria-label={`Activar ${item.label}`}
                title="Mostrar u ocultar en la barra lateral"
                checked={false}
                disabled={isPending}
                onCheckedChange={(visible) => {
                  void setScreenVisibility(item, visible);
                }}
              />
              <span>Inactiva</span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  aria-label={`Recuperar pantalla ${item.label}`}
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
                Recuperar en el menú
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
                  aria-label={`Eliminar permanentemente ${item.label}`}
                  onClick={() => openPermanentDelete(item)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                {hasSource
                  ? "Desvincula la fuente antes de eliminar"
                  : "Eliminar permanentemente"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Configurar ${item.label}`}
                  onClick={() => openScreenConfig(item)}
                >
                  <Settings aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                Configurar
              </TooltipContent>
            </Tooltip>
          </div>
        </article>
      </div>
    );
  };
  if (detail && screen) {
    const capabilities = collectionCapabilities(screen),
      binding = screen.config.studio?.collection,
      usesSourceFormSettings =
        !capabilities.schema && !capabilities.customFields;
    const options = [
      {
        group: "experience",
        icon: Eye,
        view: "records",
        label: "Ver pantalla",
        description: "Abre los registros de esta pantalla.",
      },
      {
        group: "experience",
        icon: FormInput,
        view: usesSourceFormSettings ? "records" : "designer",
        extra: usesSourceFormSettings ? { configure: "form" } : undefined,
        label: "Campos y formulario",
        description: usesSourceFormSettings
          ? "Configura la tabla y la distribución del formulario."
          : "Configura las etiquetas, los campos y el formulario.",
      },
      {
        group: "experience",
        icon: PanelTop,
        view: "screen-settings",
        label: "Presentación y menú",
        description:
          "Elige cómo se abren crear y editar, y la visibilidad en el menú.",
      },
      ...(binding
        ? [
            {
              group: "data",
              icon: Database,
              view: "screen-operations",
              label: "Operaciones del API",
              description:
                "Elige los endpoints y mapeos para listar, crear, editar y eliminar.",
            },
          ]
        : []),
      ...(domainTools
        ? [
            {
              group: "data",
              icon: Network,
              view: "screen-relations",
              label: "Relaciones",
              description:
                "Consulta y configura las conexiones de esta pantalla.",
            },
          ]
        : []),
      {
        group: "tracking",
        icon: History,
        view: "screen-audit",
        label: "Historial de cambios",
        description: "Consulta los cambios registrados para esta pantalla.",
      },
    ].filter((o) => o.view !== "records" || capabilities.read);
    const optionGroups = [
      { id: "experience", label: "Experiencia" },
      { id: "data", label: "Datos y conexiones" },
      { id: "tracking", label: "Seguimiento" },
    ]
      .map((group) => ({
        ...group,
        options: options.filter((option) => option.group === group.id),
      }))
      .filter((group) => group.options.length);
    return (
      <section
        aria-label={`Configurar ${screen.label}`}
        className="screen-admin"
      >
        <header className="screen-admin-detail-header">
          <h1>{screen.label}</h1>
          <p className="screen-admin-source">
            <Database aria-hidden="true" />
            <span>
              {binding
                ? `${binding.domain ?? binding.sourceId} · ${binding.resource}`
                : "Colección local del dominio"}
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
                          aria-label={`${option.label} de ${screen.label}`}
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
                        Abrir {option.label}
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
    <section aria-label="Administrar pantallas" className="screen-admin">
      <Tabs
        value={currentTab}
        onValueChange={(val) => setCurrentTab(val as "screens" | "packages")}
        className="screen-admin-tabs w-full space-y-6"
      >
        <div className="screen-admin-tabs-nav flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-4">
          <TabsList className="bg-muted/70 p-1 rounded-xl h-11">
            <TabsTrigger
              value="screens"
              className="gap-2 px-4 py-2 text-sm font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span>Pantallas</span>
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
              <span>Paquetes y extensiones</span>
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
                <h1>Pantallas</h1>
                {active.length > 0 && (
                  <span className="screen-admin-count">
                    {active.length} activas
                  </span>
                )}
              </div>
            </div>
            <div
              className="screen-admin-actions"
              aria-label="Herramientas del dominio"
            >
              {secondaryDomainActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Más herramientas"
                      title="Más herramientas"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      Herramientas del dominio
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
                  aria-label="Nueva pantalla"
                  title="Nueva pantalla"
                  onClick={() => onNavigate(selected, primaryDomainAction.view)}
                >
                  <Plus aria-hidden="true" />
                </Button>
              )}
            </div>
          </header>
          <section
            className="screen-admin-list savia-surface-card"
            aria-label="Pantallas"
          >
            <div className="screen-admin-screen-toolbar">
              <div className="screen-admin-menu-filter">
                <Search aria-hidden="true" />
                <Input
                  type="search"
                  aria-label="Filtrar páginas"
                  placeholder="Filtrar páginas"
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
                    aria-label="Ordenar páginas de A a Z"
                    disabled={pendingScreen === "__menu__"}
                    onClick={sortMenuAlphabetically}
                  >
                    <ArrowDownAZ aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={6}>
                  Ordenar páginas de A a Z
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
                                aria-label={`Reordenar sección ${block.label}`}
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
                                aria-label={`Nombre de la sección ${block.label}`}
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
                                    aria-label={`Eliminar sección ${block.label}`}
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
                                  Eliminar sección
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
                          Suelta aquí para mover al final
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
                  <h2>No se encontraron páginas</h2>
                  <p>Prueba con otro nombre o limpia el filtro.</p>
                </div>
              </div>
            ) : (
              <div className="screen-admin-empty">
                <LayoutDashboard
                  className="screen-admin-empty-icon"
                  aria-hidden="true"
                />
                <div>
                  <h2>Aún no tienes pantallas</h2>
                  <p>
                    Crea la primera para definir sus datos, diseño y
                    operaciones.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => onNavigate(selected, "new-object")}
                >
                  <Plus aria-hidden="true" />
                  Crear pantalla
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
          <DialogTitle>Eliminar pantalla permanentemente</DialogTitle>
          <DialogDescription>
            {hasSource
              ? "Desvincula la fuente de datos antes de eliminar esta pantalla."
              : hasRecords
                ? `«${screen.label}» tiene ${recordCount} registro${recordCount === 1 ? "" : "s"}. Se borrará la pantalla, su configuración y todos los datos relacionados.`
                : `Se borrará «${screen.label}» y su configuración.`}
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
              Entiendo que también se eliminarán {recordCount} registro
              {recordCount === 1 ? "" : "s"} y no se puede deshacer
            </span>
          </label>
        ) : null}
        <p className="screen-admin-delete-warning">
          Esta acción no se puede deshacer.
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            Cancelar
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
                Eliminando…
              </>
            ) : (
              "Eliminar permanentemente"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
