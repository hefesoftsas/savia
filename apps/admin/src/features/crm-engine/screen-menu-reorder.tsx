import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowDownAZ,
  GripVertical,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { CrmObject } from "@savia/crm-shared/metadata";
import {
  addMenuSection,
  getMenuBlocks,
  moveMenuSectionBlock,
  moveScreenToSection,
  reconcileMenuLayout,
  removeMenuSection,
  renameMenuSection,
  reorderScreensListInLayout,
  type ScreenMenuLayout,
} from "@savia/crm-shared/screen-menu-layout";
import { sortScreens } from "./screen-manager";

const screenDragType = "application/x-savia-screen-order";
const sectionDragType = "application/x-savia-menu-section";

export default function ScreenMenuReorder({
  objects,
  menuLayout,
  onMenuLayoutChange,
  renderScreenRow,
  className,
}: {
  objects: CrmObject[];
  menuLayout?: ScreenMenuLayout | null;
  onMenuLayoutChange: (layout: ScreenMenuLayout) => Promise<void>;
  renderScreenRow?: (
    item: CrmObject,
    sectionId: string | null,
    controls: {
      pending: boolean;
      dragging: boolean;
      dropTarget: boolean;
      dragHandle: ReactNode;
    },
  ) => ReactNode;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState("");
  const [draggingScreen, setDraggingScreen] = useState<string | null>(null);
  const [dropTargetScreen, setDropTargetScreen] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<string | null>(null);
  const [dropTargetSection, setDropTargetSection] = useState<string | null>(
    null,
  );
  const active = sortScreens(
    objects.filter((object) => !object.config.studio?.screen?.hidden),
  );
  const activeLayout = reconcileMenuLayout(
    menuLayout,
    active.map((screen) => screen.name),
  );
  const activeBlocks = getMenuBlocks(activeLayout);
  const screensByName = new Map(active.map((screen) => [screen.name, screen]));
  const normalizedFilter = filter.trim().toLocaleLowerCase("es");
  const filteredBlocks = normalizedFilter
    ? activeBlocks
        .map((block) => ({
          ...block,
          screens: block.screens.filter((screenName) =>
            screensByName
              .get(screenName)
              ?.label.toLocaleLowerCase("es")
              .includes(normalizedFilter),
          ),
        }))
        .filter((block) => block.screens.length)
    : activeBlocks;

  const finishDrag = () => {
    setDraggingScreen(null);
    setDropTargetScreen(null);
    setDraggingSection(null);
    setDropTargetSection(null);
  };

  const persistMenuLayout = async (next: ScreenMenuLayout) => {
    setPending(true);
    try {
      await onMenuLayoutChange(next);
    } finally {
      setPending(false);
      finishDrag();
    }
  };

  const handleScreenDrop = async (
    sourceName: string,
    target:
      | { kind: "screen"; beforeName: string }
      | { kind: "section"; sectionId: string | null }
      | { kind: "end" },
  ) => {
    if (!sourceName) {
      finishDrag();
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
      finishDrag();
      return;
    }
    await persistMenuLayout(
      moveMenuSectionBlock(activeLayout, sourceSectionId, beforeSectionId),
    );
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

  const renderDragHandle = (item: CrmObject) => (
    <button
      type="button"
      className="screen-admin-row-drag"
      draggable={!pending}
      aria-label={`Reordenar ${item.label}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(screenDragType, item.name);
        event.dataTransfer.effectAllowed = "move";
        setDraggingScreen(item.name);
      }}
      onDragEnd={finishDrag}
    >
      <GripVertical aria-hidden="true" />
    </button>
  );

  const renderDefaultScreenRow = (
    item: CrmObject,
    sectionId: string | null,
  ) => {
    const isDragging = draggingScreen === item.name;
    const isDropTarget = dropTargetScreen === item.name;
    return (
      <article
        key={item.name}
        className={`screen-admin-row screen-menu-reorder-row${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
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
        {renderDragHandle(item)}
        <span className="screen-admin-row-copy">
          <span className="screen-admin-row-title">{item.label}</span>
        </span>
      </article>
    );
  };

  const renderRow = (item: CrmObject, sectionId: string | null) => {
    const isDragging = draggingScreen === item.name;
    const isDropTarget = dropTargetScreen === item.name;
    const dragHandle = renderDragHandle(item);
    if (renderScreenRow) {
      return (
        <div
          key={item.name}
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
          {renderScreenRow(item, sectionId, {
            pending,
            dragging: isDragging,
            dropTarget: isDropTarget,
            dragHandle,
          })}
        </div>
      );
    }
    return renderDefaultScreenRow(item, sectionId);
  };

  if (!active.length) return null;

  return (
    <section
      aria-label="Orden del menú Tu negocio"
      className={`screen-admin-list savia-surface-card screen-menu-reorder${className ? ` ${className}` : ""}`}
    >
      <header className="screen-admin-list-heading">
        <h2>Orden del menú</h2>
        <span>{active.length}</span>
      </header>
      <div className="screen-admin-menu-toolbar">
        <div className="screen-admin-menu-toolbar-content">
          <p className="screen-admin-group-help">
            Arrastra para reordenar el menú de Tu negocio. Agrupa pantallas en
            secciones si lo necesitas.
          </p>
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
        </div>
        <div className="screen-admin-menu-toolbar-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Ordenar páginas de A a Z"
                disabled={pending}
                onClick={sortMenuAlphabetically}
              >
                <ArrowDownAZ aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={6}>
              Ordenar páginas de A a Z
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Agregar sección"
                disabled={pending}
                onClick={() =>
                  void persistMenuLayout(addMenuSection(activeLayout))
                }
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="text-primary" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={6}>
              Agregar sección
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {filteredBlocks.length ? (
        filteredBlocks.map((block) =>
          block.kind === "section" ? (
            <div
              key={block.id}
              className={`screen-admin-menu-section${dropTargetSection === block.id ? " is-drop-target" : ""}${draggingSection === block.id ? " is-dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggingScreen) setDropTargetSection(block.id);
              }}
              onDragLeave={() => {
                if (dropTargetSection === block.id) setDropTargetSection(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceName = event.dataTransfer.getData(screenDragType);
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
                  draggable={!pending}
                  aria-label={`Reordenar sección ${block.label}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(sectionDragType, block.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDraggingSection(block.id);
                  }}
                  onDragEnd={finishDrag}
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <Input
                  className="screen-admin-menu-section-label"
                  aria-label={`Nombre de la sección ${block.label}`}
                  defaultValue={block.label}
                  disabled={pending}
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (!label || label === block.label) return;
                    void persistMenuLayout(
                      renameMenuSection(activeLayout, block.id, label),
                    );
                  }}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      aria-label={`Eliminar sección ${block.label}`}
                      onClick={() =>
                        void persistMenuLayout(
                          removeMenuSection(activeLayout, block.id),
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
                return item ? renderRow(item, block.id) : null;
              })}
            </div>
          ) : (
            block.screens.map((screenName) => {
              const item = screensByName.get(screenName);
              return item ? renderRow(item, null) : null;
            })
          ),
        )
      ) : (
        <p className="screen-admin-menu-filter-empty">
          No se encontraron páginas con ese filtro.
        </p>
      )}
      {active.length > 1 ? (
        <div
          className={`screen-admin-drop-end${draggingScreen ? " is-visible" : ""}${dropTargetScreen === "__end__" ? " is-drop-target" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (draggingScreen) setDropTargetScreen("__end__");
          }}
          onDragLeave={() => {
            if (dropTargetScreen === "__end__") setDropTargetScreen(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const sourceName = event.dataTransfer.getData(screenDragType);
            void handleScreenDrop(sourceName, { kind: "end" });
          }}
        >
          Suelta aquí para mover al final
        </div>
      ) : null}
    </section>
  );
}
