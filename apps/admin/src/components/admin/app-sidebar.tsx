import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type ComponentProps,
  type CSSProperties,
} from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  EyeOff,
  GripVertical,
  ListTree,
  Plus,
  RotateCcw,
  Search,
  FileText,
  Trash2,
  User,
} from "lucide-react";
import { LinkBase, useTranslate } from "ra-core";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TruncatedWithTooltip } from "@/components/ui/truncated-with-tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { isCrmChildActive } from "@/features/dynamic-crm/crm-navigation";
import { useCrmSidebarNavigation } from "@/features/dynamic-crm/use-crm-sidebar-navigation";
import {
  hasLucideIconLoader,
  LucideLookupIcon,
} from "@/features/crm-engine/lucide-lookup-icon";
import { AppearancePanel } from "@/components/admin/appearance-panel";
import { UserMenu } from "@/components/admin/user-menu";
import { PwaInstallButton } from "@/pwa";
import { SidebarFlowsSkeleton } from "@/components/admin/page-skeletons";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useSaviaRequestWorkspace } from "@/features/savia-request/savia-request-provider";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";

const SaviaRequestSidebar = lazy(async () => {
  const module = await import("@/features/savia-request/savia-request-sidebar");
  return { default: module.SaviaRequestSidebar };
});
import {
  addCustomSidebarSection,
  blockKey,
  blockItems,
  isNavigationItemHidden,
  moveNavigationItem,
  moveSidebarSection,
  navigationBlockForItem,
  parseSidebarBlockSortableId,
  removeCustomSidebarSection,
  renameCustomSidebarSection,
  resolveSectionDropTarget,
  resolveSidebarDropTarget,
  sidebarBlockSortableId,
  sidebarSectionEndDropId,
  toggleNavigationItemVisibility,
} from "./sidebar-navigation-layout";
import {
  defaultSidebarNavigationLayout,
  reconcileSidebarNavigation,
  sidebarNavigationSections,
  useVisibleSidebarNavigation,
  type SidebarNavigationItem,
  type SidebarNavigationItemId,
  type SidebarNavigationLayout,
} from "./sidebar-navigation";

const navigationSaveErrorKey = "savia.sidebar.saveOrderError";
const sidebarSectionLabelClassName =
  "px-2 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase";

function sectionDropId(blockId: string): string {
  return `sidebar-section:${blockId}`;
}

function SidebarItemIcon({
  icon,
  className,
}: {
  icon: SidebarNavigationItem["icon"];
  className?: string;
}) {
  if (typeof icon === "string" && hasLucideIconLoader(icon))
    return <LucideLookupIcon name={icon} className={className} />;
  const Icon = typeof icon === "string" ? FileText : icon;
  return <Icon aria-hidden="true" className={className} />;
}

function SidebarDropIndicator() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none mx-2 h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_35%,transparent)]"
    />
  );
}

function SidebarSectionLabel({
  title,
  collapsed,
  toggleDisabled,
  editable,
  reorderable,
  saving,
  dragHandleProps,
  onRename,
  onRemove,
}: {
  title: string;
  collapsed: boolean;
  toggleDisabled?: boolean;
  editable?: boolean;
  reorderable?: boolean;
  saving?: boolean;
  dragHandleProps?: ComponentProps<"button">;
  onRename?: (label: string) => void;
  onRemove?: () => void;
}) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(title);
  useEffect(() => {
    setDraft(title);
  }, [title]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === title) {
      setDraft(title);
      return;
    }
    onRename?.(trimmed);
  };

  const dragHandle =
    reorderable && dragHandleProps ? (
      <button
        aria-label={translate("savia.sidebar.reorderSection", {
          section: title,
        })}
        className="rounded p-1 text-muted-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={saving}
        type="button"
        {...dragHandleProps}
      >
        <GripVertical className="size-3.5" />
      </button>
    ) : null;

  const toggleLabel = translate(
    collapsed ? "savia.sidebar.expandSection" : "savia.sidebar.collapseSection",
    { section: title },
  );
  const sectionChevron = (
    <ChevronRight
      aria-hidden="true"
      className={`size-3.5 shrink-0 transition-transform duration-200 ${
        collapsed ? "" : "rotate-90"
      }`}
    />
  );
  const sectionToggle = (
    <CollapsibleTrigger asChild>
      <Button
        aria-label={toggleLabel}
        className="size-7 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
        disabled={toggleDisabled}
        title={toggleLabel}
        type="button"
        variant="ghost"
      >
        {sectionChevron}
      </Button>
    </CollapsibleTrigger>
  );
  const sectionHeadingToggle = (
    <CollapsibleTrigger asChild>
      <button
        aria-label={toggleLabel}
        className="flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 group-data-[collapsible=icon]:hidden"
        disabled={toggleDisabled}
        title={toggleLabel}
        type="button"
      >
        {sectionChevron}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
    </CollapsibleTrigger>
  );

  if (!editable) {
    if (!reorderable) {
      return (
        <div className="flex items-center gap-1 pr-1">
          {sectionHeadingToggle}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 pr-1">
        {sectionHeadingToggle}
        {dragHandle}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 pr-1">
      {sectionToggle}
      {dragHandle}
      <SidebarGroupLabel
        className={`${sidebarSectionLabelClassName} h-auto min-h-8 flex-1 py-1`}
      >
        <input
          aria-label={translate("savia.sidebar.sectionName", {
            section: title,
          })}
          className="w-full min-w-0 border-0 bg-transparent p-0 text-inherit font-inherit tracking-[0.08em] uppercase text-muted-foreground/80 outline-none focus-visible:outline-none"
          disabled={saving}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </SidebarGroupLabel>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        disabled={saving}
        aria-label={translate("savia.sidebar.removeSection", {
          section: title,
        })}
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function matchesNavigationSearch(search: string, label: string) {
  const normalizedSearch = normalizeNavigationText(search);
  return (
    normalizedSearch.length === 0 ||
    normalizeNavigationText(label).includes(normalizedSearch)
  );
}

function normalizeNavigationText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/**
 * Navigation sidebar with a user-scoped, server-persisted ordering for links.
 * Account and appearance controls intentionally remain outside the reorderable area.
 */
export function AppSidebar() {
  const translate = useTranslate();
  const currentTenant = useCurrentTenant();
  const services = useAppServices();
  const { openMobile, setOpenMobile, state } = useSidebar();
  const { active: saviaRequestActive } = useSaviaRequestWorkspace();
  const {
    isLoading,
    layout: defaultLayout,
    itemsById: staticItems,
  } = useVisibleSidebarNavigation();
  const location = useLocation();
  const { children: crmChildren, domainId } = useCrmSidebarNavigation(
    Boolean(staticItems["dynamic-crm"]),
  );
  const pageAdmin = crmChildren.find((child) => child.id === "studio:admin");
  const itemsById = useMemo(() => {
    const items = { ...staticItems };
    delete items["dynamic-crm"];
    if (domainId)
      for (const page of crmChildren.filter(
        (child) => child.group === "objects",
      )) {
        const id: SidebarNavigationItemId = `page:${encodeURIComponent(domainId)}:${page.id.slice("object:".length)}`;
        items[id] = {
          id,
          label: page.label,
          route: page.route,
          section: page.section ?? "operation",
          icon: page.icon ?? FileText,
          count: page.count,
          active:
            location.pathname === "/crm" &&
            isCrmChildActive(page, location.search),
        };
      }
    if (pageAdmin) {
      items["page-administrator"] = {
        id: "page-administrator",
        label: translate("savia.sidebar.items.page-administrator"),
        labelKey: "savia.sidebar.items.page-administrator",
        route: pageAdmin.route,
        section: "management",
        icon: ListTree,
        active:
          location.pathname === "/crm" &&
          isCrmChildActive(pageAdmin, location.search),
      };
    }
    return items;
  }, [
    staticItems,
    crmChildren,
    domainId,
    location.pathname,
    location.search,
    pageAdmin,
    translate,
  ]);
  const pageDefaultSections = useMemo(() => {
    if (!domainId) return {};
    return Object.fromEntries(
      crmChildren
        .filter((child) => child.group === "objects")
        .map((child) => [
          `page:${encodeURIComponent(domainId)}:${child.id.slice("object:".length)}`,
          child.section ?? "operation",
        ]),
    ) as Partial<
      Record<SidebarNavigationItemId, SidebarNavigationItem["section"]>
    >;
  }, [crmChildren, domainId]);
  const [search, setSearch] = useState("");
  const [organizationMode, setOrganizationMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] =
    useState<SidebarNavigationItemId | null>(null);
  const [activeDragSectionId, setActiveDragSectionId] = useState<string | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<{
    blockId: string;
    index: number;
  } | null>(null);
  const [sectionDropTarget, setSectionDropTarget] = useState<{
    beforeBlockId: string | null;
  } | null>(null);
  const [layout, setLayout] = useState<SidebarNavigationLayout | null>(null);
  const [confirmedLayout, setConfirmedLayout] =
    useState<SidebarNavigationLayout | null>(null);
  const didLoadPreferences = useRef(false);
  const visibleItemIds = useMemo(
    () =>
      Object.keys(itemsById).filter((id): id is SidebarNavigationItemId =>
        Boolean(itemsById[id as SidebarNavigationItemId]),
      ),
    [itemsById],
  );
  const fallbackLayout = useMemo<SidebarNavigationLayout>(
    () => defaultLayout,
    [defaultLayout],
  );
  const displayedLayout = useMemo(
    () =>
      reconcileSidebarNavigation(
        layout ?? fallbackLayout,
        visibleItemIds,
        pageDefaultSections,
      ),
    [fallbackLayout, layout, pageDefaultSections, visibleItemIds],
  );
  const layoutForSave = () => layout ?? confirmedLayout ?? displayedLayout;
  const blockSortableIds = useMemo(
    () =>
      displayedLayout.blocks.map((block) =>
        sidebarBlockSortableId(blockKey(block)),
      ),
    [displayedLayout.blocks],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const searching = search.trim().length > 0;
  const canOrganize =
    !isLoading && state === "expanded" && !searching && !saving;
  const activeDragSectionTitle = useMemo(() => {
    if (!activeDragSectionId) return null;
    const block = displayedLayout.blocks.find(
      (candidate) => blockKey(candidate) === activeDragSectionId,
    );
    if (!block) return activeDragSectionId;
    if (block.kind === "builtin") {
      return translate(
        sidebarNavigationSections.find((section) => section.id === block.id)!
          .labelKey,
      );
    }
    return block.label;
  }, [activeDragSectionId, displayedLayout.blocks, translate]);

  useEffect(() => {
    if (isLoading || didLoadPreferences.current) return;
    didLoadPreferences.current = true;
    const fallback = defaultSidebarNavigationLayout();
    const preferences = services.userPreferences;
    if (!preferences) {
      setLayout(fallback);
      setConfirmedLayout(fallback);
      return;
    }

    let active = true;
    void preferences.getSidebarNavigation().then(
      (saved) => {
        if (!active) return;
        setLayout(saved);
        setConfirmedLayout(saved);
      },
      () => {
        if (!active) return;
        setLayout(fallback);
        setConfirmedLayout(fallback);
      },
    );
    return () => {
      active = false;
    };
  }, [isLoading, services]);

  const closeMobileSidebar = () => {
    if (openMobile) setOpenMobile(false);
  };

  const persistLayout = async (nextLayout: SidebarNavigationLayout) => {
    const lastConfirmed = confirmedLayout ?? displayedLayout;
    const preservedItems = lastConfirmed.blocks.flatMap((block) =>
      blockItems(block).filter(
        (id) =>
          id.startsWith("page:") &&
          !visibleItemIds.includes(id) &&
          !nextLayout.blocks.some((candidate) =>
            blockItems(candidate).includes(id),
          ),
      ),
    );
    if (preservedItems.length) {
      const operationBlock = nextLayout.blocks.find(
        (block) => block.kind === "builtin" && block.id === "operation",
      );
      if (operationBlock) {
        nextLayout = {
          version: 2,
          ...(nextLayout.hiddenItems
            ? { hiddenItems: nextLayout.hiddenItems }
            : {}),
          blocks: nextLayout.blocks.map((block) =>
            blockKey(block) === blockKey(operationBlock)
              ? {
                  ...block,
                  items: [...blockItems(block), ...preservedItems],
                }
              : block,
          ),
        };
      }
    }
    setSaveError(null);
    setLayout(nextLayout);
    setSaving(true);
    try {
      const preferences = services.userPreferences;
      const saved = preferences
        ? await preferences.saveSidebarNavigation(nextLayout)
        : nextLayout;
      setLayout(saved);
      setConfirmedLayout(saved);
    } catch (error) {
      setLayout(lastConfirmed);
      const message = translate(navigationSaveErrorKey);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (blockId: string, collapsed: boolean) => {
    if (saving || organizationMode || searching) return;
    void persistLayout({
      version: 2,
      ...(displayedLayout.hiddenItems
        ? { hiddenItems: displayedLayout.hiddenItems }
        : {}),
      blocks: displayedLayout.blocks.map((block) =>
        blockKey(block) === blockId ? { ...block, collapsed } : block,
      ),
    });
  };

  const toggleVisibility = (itemId: SidebarNavigationItemId) => {
    if (saving) return;
    void persistLayout(toggleNavigationItemVisibility(layoutForSave(), itemId));
  };

  const moveWithControls = (
    itemId: SidebarNavigationItemId,
    destinationBlockId: string,
    destinationIndex: number,
  ) => {
    if (saving) return;
    void persistLayout(
      moveNavigationItem(
        displayedLayout,
        itemId,
        destinationBlockId,
        destinationIndex,
      ),
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (!organizationMode || saving) return;
    const activeId = String(event.active.id);
    const sectionBlockId = parseSidebarBlockSortableId(activeId);
    if (sectionBlockId) {
      setActiveDragSectionId(sectionBlockId);
      setActiveDragId(null);
      setDropTarget(null);
      setSectionDropTarget(null);
      return;
    }
    setActiveDragSectionId(null);
    setActiveDragId(activeId as SidebarNavigationItemId);
    setSectionDropTarget(null);
    setDropTarget(null);
  };

  const clearDragState = () => {
    setActiveDragId(null);
    setActiveDragSectionId(null);
    setDropTarget(null);
    setSectionDropTarget(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!organizationMode || saving || !event.over) {
      setDropTarget(null);
      setSectionDropTarget(null);
      return;
    }
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    if (activeId === overId) {
      setDropTarget(null);
      setSectionDropTarget(null);
      return;
    }

    const sectionBlockId = parseSidebarBlockSortableId(activeId);
    if (sectionBlockId) {
      setDropTarget(null);
      setSectionDropTarget(
        resolveSectionDropTarget(displayedLayout, sectionBlockId, overId),
      );
      return;
    }

    setSectionDropTarget(null);
    setDropTarget(
      resolveSidebarDropTarget(
        displayedLayout,
        activeId as SidebarNavigationItemId,
        overId,
      ),
    );
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    clearDragState();
  };

  useEffect(() => {
    if (!organizationMode) {
      setActiveDragId(null);
      setActiveDragSectionId(null);
      setDropTarget(null);
      setSectionDropTarget(null);
    }
  }, [organizationMode]);

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const draggingSectionId = parseSidebarBlockSortableId(activeId);
    const resolvedSectionTarget =
      draggingSectionId && overId
        ? resolveSectionDropTarget(displayedLayout, draggingSectionId, overId)
        : sectionDropTarget;
    const resolvedItemTarget =
      !draggingSectionId && overId
        ? resolveSidebarDropTarget(
            displayedLayout,
            activeId as SidebarNavigationItemId,
            overId,
          )
        : dropTarget;

    clearDragState();

    if (saving || !event.over || activeId === overId) return;

    if (draggingSectionId && resolvedSectionTarget) {
      void persistLayout(
        moveSidebarSection(
          layoutForSave(),
          draggingSectionId,
          resolvedSectionTarget.beforeBlockId ?? undefined,
        ),
      );
      return;
    }

    const itemId = activeId as SidebarNavigationItemId;
    if (!itemsById[itemId] || !resolvedItemTarget) return;
    moveWithControls(
      itemId,
      resolvedItemTarget.blockId,
      resolvedItemTarget.index,
    );
  };

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <LinkBase
                to="/"
                onClick={closeMobileSidebar}
                className="flex items-center gap-2.5 min-w-0"
              >
                {currentTenant.isDedicated ? (
                  <>
                    <div
                      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold text-xs tracking-wider shadow-sm"
                      title={currentTenant.name}
                      aria-hidden="true"
                    >
                      {currentTenant.monogram}
                    </div>
                    <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden leading-tight">
                      <span className="truncate font-semibold text-sm text-foreground">
                        {currentTenant.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground tracking-tight">
                        Espacio de trabajo · Savia
                      </span>
                    </div>
                    <span className="sr-only">{currentTenant.name}</span>
                  </>
                ) : (
                  <>
                    <img
                      src="/savia-logo-large.png"
                      alt="Savia"
                      className="h-6 w-auto object-contain group-data-[collapsible=icon]:hidden"
                    />
                    <img
                      src="/favicon-32x32.png"
                      alt="Savia"
                      className="hidden !size-5 rounded-[4px] object-cover group-data-[collapsible=icon]:block"
                    />
                    <span className="sr-only">Savia</span>
                  </>
                )}
              </LinkBase>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="space-y-1.5 group-data-[collapsible=icon]:hidden">
          <div className="group/sidebar-header relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <SidebarInput
              aria-label={translate("savia.sidebar.searchLabel")}
              className="h-9 pr-10 pl-8 text-sm placeholder:text-muted-foreground/80"
              disabled={organizationMode}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={translate("savia.sidebar.searchPlaceholder")}
              type="search"
              value={search}
            />
            {!organizationMode ? (
              <Button
                aria-label={translate("savia.sidebar.organizeMenu")}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 md:pointer-events-none md:opacity-0 md:group-hover/sidebar-header:pointer-events-auto md:group-hover/sidebar-header:opacity-100 md:group-focus-within/sidebar-header:pointer-events-auto md:group-focus-within/sidebar-header:opacity-100"
                disabled={!canOrganize}
                onClick={() => setOrganizationMode(true)}
                size="icon"
                title={translate("savia.sidebar.organizeMenu")}
                type="button"
                variant="ghost"
              >
                <ListTree />
                <span className="sr-only">
                  {translate("savia.sidebar.organizeMenu")}
                </span>
              </Button>
            ) : null}
          </div>
          {organizationMode ? (
            <div
              aria-label={translate("savia.sidebar.organizeMenu")}
              className="rounded-lg border border-sidebar-border/60 bg-sidebar-accent/35 p-1.5"
              role="toolbar"
            >
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  className="h-8 shadow-none"
                  disabled={saving}
                  onClick={() => {
                    if (document.activeElement instanceof HTMLInputElement) {
                      document.activeElement.blur();
                    }
                    setOrganizationMode(false);
                  }}
                  size="sm"
                  type="button"
                  variant="default"
                >
                  {translate("savia.sidebar.done")}
                </Button>
                <Button
                  aria-label={translate("savia.sidebar.addSection")}
                  className="h-8 min-w-0 px-2 shadow-none"
                  disabled={saving}
                  onClick={() =>
                    void persistLayout(
                      addCustomSidebarSection(
                        layoutForSave(),
                        translate("savia.sidebar.newSection"),
                      ),
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus className="size-3.5 shrink-0" />
                  <TruncatedWithTooltip>
                    {translate("savia.sidebar.addSectionShort")}
                  </TruncatedWithTooltip>
                </Button>
              </div>
              <Button
                aria-label={translate("savia.sidebar.resetOrder")}
                className="mt-1.5 h-7 w-full min-w-0 text-xs text-muted-foreground hover:text-foreground"
                disabled={saving}
                onClick={() =>
                  void persistLayout(defaultSidebarNavigationLayout())
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                <RotateCcw className="size-3.5 shrink-0" />
                <TruncatedWithTooltip>
                  {translate("savia.sidebar.resetOrderShort")}
                </TruncatedWithTooltip>
              </Button>
            </div>
          ) : null}
          {saveError ? (
            <p className="px-1 text-xs text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <DndContext
          collisionDetection={closestCenter}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <SortableContext
            items={blockSortableIds}
            strategy={verticalListSortingStrategy}
          >
            {displayedLayout.blocks.map((block, blockIndex) => {
              const blockId = blockKey(block);
              const itemIds = blockItems(block).filter((id) => {
                const item = itemsById[id];
                if (!item) return false;
                if (
                  !organizationMode &&
                  isNavigationItemHidden(displayedLayout, id)
                ) {
                  return false;
                }
                return (
                  organizationMode ||
                  matchesNavigationSearch(search, item.label)
                );
              });
              const items = itemIds
                .map((id) => itemsById[id])
                .filter((item): item is SidebarNavigationItem => Boolean(item));
              if (
                !organizationMode &&
                items.length === 0 &&
                block.kind !== "custom"
              ) {
                return null;
              }

              const title =
                block.kind === "builtin"
                  ? translate(
                      sidebarNavigationSections.find(
                        (section) => section.id === block.id,
                      )!.labelKey,
                    )
                  : block.label;
              const previousBlock = displayedLayout.blocks[blockIndex - 1];
              const nextBlock = displayedLayout.blocks[blockIndex + 1];
              const showSectionDropBefore =
                organizationMode &&
                activeDragSectionId &&
                activeDragSectionId !== blockId &&
                sectionDropTarget?.beforeBlockId === blockId;

              return (
                <Fragment key={blockId}>
                  {showSectionDropBefore ? (
                    <div className="px-2 py-1">
                      <SidebarDropIndicator />
                    </div>
                  ) : null}
                  <NavigationSection
                    activeDragId={activeDragId}
                    activeDragSectionId={activeDragSectionId}
                    block={block}
                    blockId={blockId}
                    blockSortableId={sidebarBlockSortableId(blockId)}
                    collapsed={block.collapsed === true}
                    displayedLayout={displayedLayout}
                    dropTarget={dropTarget}
                    items={items}
                    nextBlockId={nextBlock ? blockKey(nextBlock) : undefined}
                    onMove={moveWithControls}
                    onNavigate={closeMobileSidebar}
                    onRemove={
                      block.kind === "custom"
                        ? () =>
                            void persistLayout(
                              removeCustomSidebarSection(
                                layoutForSave(),
                                block.id,
                              ),
                            )
                        : undefined
                    }
                    onToggleCollapsed={(collapsed) =>
                      toggleSection(blockId, collapsed)
                    }
                    onToggleVisibility={toggleVisibility}
                    onRename={
                      block.kind === "custom"
                        ? (label) =>
                            void persistLayout(
                              renameCustomSidebarSection(
                                layoutForSave(),
                                block.id,
                                label,
                              ),
                            )
                        : undefined
                    }
                    organizationMode={organizationMode}
                    previousBlockId={
                      previousBlock ? blockKey(previousBlock) : undefined
                    }
                    saving={saving}
                    search={search}
                    saviaRequestActive={saviaRequestActive}
                    title={title}
                  />
                </Fragment>
              );
            })}
            {organizationMode && activeDragSectionId ? (
              <SidebarSectionEndDropZone
                active={sectionDropTarget?.beforeBlockId === null}
              />
            ) : null}
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeDragSectionId && activeDragSectionTitle ? (
              <SidebarSectionDragPreview title={activeDragSectionTitle} />
            ) : activeDragId && itemsById[activeDragId] ? (
              <SidebarDragPreview item={itemsById[activeDragId]} />
            ) : null}
          </DragOverlay>
        </DndContext>
        {!organizationMode &&
        !isLoading &&
        searching &&
        displayedLayout.blocks.every((block) =>
          blockItems(block).every((id) => {
            const item = itemsById[id];
            return (
              !item ||
              isNavigationItemHidden(displayedLayout, id) ||
              !matchesNavigationSearch(search, item.label)
            );
          }),
        ) ? (
          <SidebarGroup className="py-2">
            <SidebarGroupContent>
              <p className="px-2 py-3 text-sm leading-5 text-muted-foreground">
                {translate("savia.sidebar.noSearchResults")}
              </p>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="gap-2">
        <AppearancePanel />
        <SidebarMenu className="rounded-xl bg-sidebar-primary/12 p-1 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
          <SidebarMenuItem>
            <PwaInstallButton variant="sidebar" />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UserMenu>
              <DropdownMenuItem
                asChild
                className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors"
              >
                <LinkBase to="/account" onClick={closeMobileSidebar}>
                  <User className="size-4 text-muted-foreground" />
                  <span>{translate("savia.account.myAccount")}</span>
                </LinkBase>
              </DropdownMenuItem>
            </UserMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavigationSection({
  block,
  blockId,
  blockSortableId,
  collapsed,
  displayedLayout,
  title,
  items,
  search,
  organizationMode,
  saviaRequestActive,
  saving,
  activeDragId,
  activeDragSectionId,
  dropTarget,
  onNavigate,
  onMove,
  onRename,
  onRemove,
  onToggleCollapsed,
  onToggleVisibility,
  previousBlockId,
  nextBlockId,
}: {
  block: SidebarNavigationLayout["blocks"][number];
  blockId: string;
  blockSortableId: string;
  collapsed: boolean;
  displayedLayout: SidebarNavigationLayout;
  title: string;
  items: SidebarNavigationItem[];
  organizationMode: boolean;
  saviaRequestActive: boolean;
  saving: boolean;
  activeDragId: SidebarNavigationItemId | null;
  activeDragSectionId: string | null;
  dropTarget: { blockId: string; index: number } | null;
  search: string;
  onNavigate(): void;
  onMove(
    itemId: SidebarNavigationItemId,
    destinationBlockId: string,
    destinationIndex: number,
  ): void;
  onRename?: (label: string) => void;
  onRemove?: () => void;
  onToggleCollapsed(collapsed: boolean): void;
  onToggleVisibility(itemId: SidebarNavigationItemId): void;
  previousBlockId?: string;
  nextBlockId?: string;
}) {
  const translate = useTranslate();
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: blockSortableId,
    disabled: !organizationMode || saving,
  });
  const { isOver, setNodeRef: setDroppableRef } = useDroppable({
    id: sectionDropId(blockId),
  });
  const sectionDropActive =
    organizationMode &&
    !activeDragSectionId &&
    dropTarget?.blockId === blockId &&
    (items.length === 0 || dropTarget.index === items.length);
  const sectionHighlighted =
    organizationMode && !activeDragSectionId && (isOver || sectionDropActive);
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : undefined,
  };

  const searching = search.trim().length > 0;
  const sectionOpen = organizationMode || searching || !collapsed;

  return (
    <Collapsible
      className="w-full"
      disabled={organizationMode || searching || saving}
      onOpenChange={(open) => onToggleCollapsed(!open)}
      open={sectionOpen}
    >
      <SidebarGroup
        ref={setSortableRef}
        style={style}
        className={`py-1 transition-colors ${
          sectionHighlighted
            ? "rounded-md bg-primary/5 ring-1 ring-primary/30"
            : ""
        }`}
      >
        <SidebarSectionLabel
          collapsed={!sectionOpen}
          dragHandleProps={{ ...attributes, ...listeners }}
          editable={organizationMode && block.kind === "custom"}
          onRemove={onRemove}
          onRename={onRename}
          reorderable={organizationMode}
          saving={saving}
          title={title}
          toggleDisabled={organizationMode || searching || saving}
        />
        <CollapsibleContent>
          <SidebarGroupContent ref={setDroppableRef}>
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <SidebarMenu>
                {items.map((item, index) => (
                  <SortableNavigationItem
                    activeDragId={activeDragId}
                    blockId={blockId}
                    dropTarget={dropTarget}
                    isHidden={isNavigationItemHidden(displayedLayout, item.id)}
                    item={item}
                    key={item.id}
                    nextBlockId={nextBlockId}
                    onMove={onMove}
                    onNavigate={onNavigate}
                    onToggleVisibility={onToggleVisibility}
                    organizationMode={organizationMode}
                    position={index}
                    previousBlockId={previousBlockId}
                    saviaRequestActive={saviaRequestActive}
                    saving={saving}
                    sectionLength={items.length}
                  />
                ))}
                {organizationMode &&
                dropTarget?.blockId === blockId &&
                dropTarget.index === items.length &&
                items.length > 0 ? (
                  <li aria-hidden="true" className="list-none px-1 py-0.5">
                    <SidebarDropIndicator />
                  </li>
                ) : null}
                {organizationMode && items.length === 0 && sectionDropActive ? (
                  <li
                    aria-hidden="true"
                    className="list-none px-3 py-2 text-xs text-muted-foreground"
                  >
                    {translate("savia.sidebar.dropHere")}
                  </li>
                ) : null}
              </SidebarMenu>
            </SortableContext>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function SortableNavigationItem({
  item,
  blockId,
  position,
  sectionLength,
  organizationMode,
  saviaRequestActive,
  saving,
  activeDragId,
  dropTarget,
  isHidden,
  onNavigate,
  onMove,
  onToggleVisibility,
  previousBlockId,
  nextBlockId,
}: {
  item: SidebarNavigationItem;
  blockId: string;
  position: number;
  sectionLength: number;
  organizationMode: boolean;
  saviaRequestActive: boolean;
  saving: boolean;
  activeDragId: SidebarNavigationItemId | null;
  dropTarget: { blockId: string; index: number } | null;
  isHidden?: boolean;
  onNavigate(): void;
  onMove(
    itemId: SidebarNavigationItemId,
    destinationBlockId: string,
    destinationIndex: number,
  ): void;
  onToggleVisibility?(itemId: SidebarNavigationItemId): void;
  previousBlockId?: string;
  nextBlockId?: string;
}) {
  const translate = useTranslate();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !organizationMode || saving });
  const showDropBefore =
    organizationMode &&
    activeDragId &&
    activeDragId !== item.id &&
    dropTarget?.blockId === blockId &&
    dropTarget.index === position;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : undefined,
  };
  return (
    <SidebarMenuItem ref={setNodeRef} style={style}>
      {showDropBefore ? (
        <div className="px-1 py-0.5">
          <SidebarDropIndicator />
        </div>
      ) : null}
      {organizationMode ? (
        <div
          className={`flex min-h-8 items-center gap-1 rounded-md px-1 text-sm transition-opacity hover:bg-sidebar-accent ${
            showDropBefore ? "bg-primary/5" : ""
          } ${isHidden ? "opacity-50 text-muted-foreground" : ""}`}
        >
          <button
            aria-label={translate("savia.sidebar.reorder", {
              item: item.label,
            })}
            className="rounded p-1 text-muted-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={saving}
            type="button"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <LinkBase
            className="flex min-w-0 flex-1 items-center gap-2 py-1"
            onClick={onNavigate}
            to={item.route}
          >
            <SidebarItemIcon icon={item.icon} className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {isHidden ? (
              <EyeOff
                className="size-3.5 shrink-0 text-muted-foreground/70"
                aria-hidden="true"
              />
            ) : null}
          </LinkBase>
          <div className="flex items-center">
            <Switch
              aria-label={translate(
                isHidden ? "savia.sidebar.showItem" : "savia.sidebar.hideItem",
                { item: item.label },
              )}
              checked={!isHidden}
              className="mr-1 scale-75 origin-center shrink-0 cursor-pointer"
              disabled={saving}
              onCheckedChange={() => onToggleVisibility?.(item.id)}
              title={translate(
                isHidden ? "savia.sidebar.showItem" : "savia.sidebar.hideItem",
                { item: item.label },
              )}
            />
            <button
              aria-label={translate("savia.sidebar.moveUp", {
                item: item.label,
              })}
              className="rounded p-1 hover:bg-background disabled:opacity-40"
              disabled={saving || position === 0}
              onClick={() => onMove(item.id, blockId, position - 1)}
              type="button"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              aria-label={translate("savia.sidebar.moveDown", {
                item: item.label,
              })}
              className="rounded p-1 hover:bg-background disabled:opacity-40"
              disabled={saving || position === sectionLength - 1}
              onClick={() => onMove(item.id, blockId, position + 1)}
              type="button"
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              aria-label={translate("savia.sidebar.moveToPreviousGroup", {
                item: item.label,
              })}
              className="rounded p-1 hover:bg-background disabled:opacity-40"
              disabled={saving || !previousBlockId}
              onClick={() =>
                previousBlockId &&
                onMove(item.id, previousBlockId, Number.MAX_SAFE_INTEGER)
              }
              type="button"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              aria-label={translate("savia.sidebar.moveToNextGroup", {
                item: item.label,
              })}
              className="rounded p-1 hover:bg-background disabled:opacity-40"
              disabled={saving || !nextBlockId}
              onClick={() =>
                nextBlockId &&
                onMove(item.id, nextBlockId, Number.MAX_SAFE_INTEGER)
              }
              type="button"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      ) : item.id === "provider-credentials" && saviaRequestActive ? (
        <SaviaRequestCollapsibleMenu item={item} onNavigate={onNavigate} />
      ) : (
        <SidebarMenuButton asChild isActive={item.active}>
          <LinkBase to={item.route} onClick={onNavigate}>
            <SidebarItemIcon icon={item.icon} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.count != null && (
              <span className="text-muted-foreground ml-auto tabular-nums group-data-[collapsible=icon]:hidden">
                {item.count}
              </span>
            )}
          </LinkBase>
        </SidebarMenuButton>
      )}
    </SidebarMenuItem>
  );
}

function SidebarSectionEndDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: sidebarSectionEndDropId(),
  });
  const highlighted = active || isOver;
  return (
    <div
      ref={setNodeRef}
      className={`mx-2 min-h-6 rounded-md transition-colors ${
        highlighted ? "bg-primary/5 ring-1 ring-primary/30" : ""
      }`}
    >
      {highlighted ? (
        <div className="px-1 py-1">
          <SidebarDropIndicator />
        </div>
      ) : null}
    </div>
  );
}

function SidebarSectionDragPreview({ title }: { title: string }) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md border border-primary/30 bg-sidebar px-2 py-1 text-sm shadow-md ring-2 ring-primary/20">
      <GripVertical
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span
        className={`truncate font-semibold ${sidebarSectionLabelClassName}`}
      >
        {title}
      </span>
    </div>
  );
}

function SidebarDragPreview({ item }: { item: SidebarNavigationItem }) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md border border-primary/30 bg-sidebar px-2 py-1 text-sm shadow-md ring-2 ring-primary/20">
      <GripVertical
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <SidebarItemIcon icon={item.icon} className="size-4 shrink-0" />
      <span className="truncate font-medium">{item.label}</span>
    </div>
  );
}

function SaviaRequestCollapsibleMenu({
  item,
  onNavigate,
}: {
  item: SidebarNavigationItem;
  onNavigate(): void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible
      className="group/collapsible w-full"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <SidebarMenuButton isActive={item.active} tooltip={item.label}>
          <SidebarItemIcon icon={item.icon} />
          <span>{item.label}</span>
          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </SidebarMenuButton>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Suspense fallback={<SidebarFlowsSkeleton count={3} />}>
          <SaviaRequestSidebar nested onNavigate={onNavigate} />
        </Suspense>
      </CollapsibleContent>
    </Collapsible>
  );
}
