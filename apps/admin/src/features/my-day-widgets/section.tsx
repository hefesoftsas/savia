import { useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Boxes,
  CalendarDays,
  GripVertical,
  LayoutGrid,
  Plus,
  PlusCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import type { UserPreferencesClient } from "@/api/user-preferences-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddWidgetDialog } from "./add-widget-dialog";
import {
  AgendaWidgetBody,
  CALENDAR_CONNECT_MESSAGE,
  QuickTaskWidgetBody,
  useMyDayAgenda,
  type PersonalIntegrationsLike,
} from "./agenda-widget";
import { listWidgetCollections } from "./data";
import { useMyDayWidgets } from "./use-my-day-widgets";
import { WidgetCard } from "./widgets";
import type { MyDayWidget } from "@savia/crm-shared/my-day-widgets";
import { useEffect } from "react";

const MAX_WIDGETS = 12;

function useCollectionLabels(
  apiClient: ApiClient | undefined,
  widgets: MyDayWidget[],
) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!apiClient || widgets.length === 0) return;
    const collectionWidgets = widgets.filter(
      (widget): widget is Extract<MyDayWidget, { apiBasePath: string }> =>
        "apiBasePath" in widget && "collection" in widget,
    );
    if (collectionWidgets.length === 0) return;
    let active = true;
    const domains = [
      ...new Set(collectionWidgets.map((widget) => widget.apiBasePath)),
    ];
    void Promise.allSettled(
      domains.map((apiBasePath) =>
        listWidgetCollections(apiClient, apiBasePath).then((collections) => ({
          apiBasePath,
          collections,
        })),
      ),
    ).then((results) => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const collection of result.value.collections) {
          next[`${collection.apiBasePath}:${collection.name}`] =
            collection.label;
        }
      }
      setLabels(next);
    });
    return () => {
      active = false;
    };
  }, [apiClient, widgets]);
  return labels;
}

function widgetSpanClass(widget: MyDayWidget): string {
  if (widget.kind === "agenda") return "md:col-span-2 xl:col-span-2";
  return "";
}

function SortableWidgetItem({
  widget,
  children,
  disabled,
}: {
  widget: MyDayWidget;
  children: (handleProps: {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
  }) => React.ReactNode;
  disabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${widgetSpanClass(widget)} ${isDragging ? "opacity-40" : ""}`}
    >
      {children({
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
      })}
    </div>
  );
}

export function MyDayWidgetsSection({
  apiClient,
  userPreferences,
  personalIntegrations,
}: {
  apiClient?: ApiClient;
  userPreferences?: UserPreferencesClient;
  personalIntegrations?: PersonalIntegrationsLike;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const {
    widgets,
    loading,
    saving,
    feedback,
    unavailable,
    add,
    remove,
    move,
    reorder,
    reload,
    hasSystemWidget,
  } = useMyDayWidgets(userPreferences);
  const labels = useCollectionLabels(apiClient, widgets);
  const agenda = useMyDayAgenda(personalIntegrations);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortableIds = useMemo(
    () => widgets.map((widget) => widget.id),
    [widgets],
  );
  const existingKinds = useMemo(
    () => widgets.map((widget) => widget.kind),
    [widgets],
  );
  const activeWidget = activeId
    ? widgets.find((widget) => widget.id === activeId)
    : undefined;

  if (!userPreferences && !apiClient && !personalIntegrations) return null;

  const full = widgets.length >= MAX_WIDGETS;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void reorder(String(active.id), String(over.id));
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  function collectionLabelFor(widget: MyDayWidget): string {
    if (!("apiBasePath" in widget) || !("collection" in widget)) {
      if (widget.kind === "agenda") return "Agenda";
      if (widget.kind === "quick_task") return "Tarea rápida";
      return widget.title ?? widget.kind;
    }
    return (
      labels[`${widget.apiBasePath}:${widget.collection}`] ??
      widget.title ??
      widget.collection
    );
  }

  return (
    <section aria-label="Mis widgets" className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <LayoutGrid className="size-4 text-primary" aria-hidden="true" />
          </span>
          <h2 className="text-xl font-semibold tracking-tight">Mi tablero</h2>
          {!loading && widgets.length > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {widgets.length}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hasSystemWidget("agenda") && !loading ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() =>
                void add({ id: "agenda", kind: "agenda" } as MyDayWidget)
              }
            >
              <CalendarDays aria-hidden="true" />
              Mostrar agenda
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || saving}
            onClick={() => {
              void agenda.refresh();
              void reload();
            }}
          >
            <RefreshCw
              className={loading ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            Actualizar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || saving || full}
            onClick={() => setDialogOpen(true)}
          >
            <Plus aria-hidden="true" />
            Agregar widget
          </Button>
        </div>
      </div>

      {agenda.feedback ? (
        <Alert className="mb-4" aria-label={agenda.feedback}>
          <div className="col-start-2 flex items-start gap-2">
            <AlertDescription className="flex-1">
              {agenda.feedback}
            </AlertDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => {
                if (agenda.feedback === CALENDAR_CONNECT_MESSAGE) {
                  agenda.dismissConnectNotice();
                } else {
                  agenda.setFeedback(null);
                }
              }}
              aria-label="Cerrar aviso"
              title="Cerrar aviso"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </Alert>
      ) : null}
      {feedback ? (
        <Alert className="mb-4" aria-label={feedback}>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-label="Cargando widgets…"
        >
          <span className="sr-only">Cargando widgets…</span>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="space-y-2 rounded-2xl border border-border/60 bg-card p-5 shadow-sm"
            >
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div
          className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-gradient-to-b from-muted/60 to-muted/20 px-6 py-12 text-center shadow-sm"
          data-testid="my-day-widgets-empty"
        >
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <Boxes aria-hidden="true" className="size-7 text-primary" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-foreground">
            Arma tu día
          </h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Agrega tu agenda y widgets de tus colecciones para ver resúmenes,
            vencimientos y elementos recientes sin abrir cada pantalla. Arrastra
            para ordenar, quita y vuelve a agregar cuando quieras.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDialogOpen(true)}
            >
              <Plus aria-hidden="true" />
              Agregar tu primer widget
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void add({ id: "agenda", kind: "agenda" } as MyDayWidget)
              }
            >
              <CalendarDays aria-hidden="true" />
              Mostrar agenda
            </Button>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {widgets.map((widget, index) => (
                <SortableWidgetItem
                  key={widget.id}
                  widget={widget}
                  disabled={saving}
                >
                  {({ attributes, listeners }) => (
                    <WidgetCard
                      apiClient={apiClient}
                      widget={widget}
                      collectionLabel={collectionLabelFor(widget)}
                      agenda={widget.kind === "agenda" ? { agenda } : undefined}
                      quickTask={
                        widget.kind === "quick_task"
                          ? {
                              agenda,
                              personalIntegrations,
                            }
                          : undefined
                      }
                      onRemove={(id) => void remove(id)}
                      onMove={(id, direction) => void move(id, direction)}
                      isFirst={index === 0}
                      isLast={index === widgets.length - 1}
                      disabled={saving}
                      dragHandle={
                        <button
                          type="button"
                          aria-label={`Arrastrar widget ${collectionLabelFor(widget)}`}
                          className="flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
                          {...attributes}
                          {...listeners}
                        >
                          <GripVertical className="size-4" aria-hidden="true" />
                        </button>
                      }
                    />
                  )}
                </SortableWidgetItem>
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeWidget ? (
              <div className="rounded-2xl border border-primary/40 bg-card p-4 shadow-xl">
                <p className="text-sm font-semibold">
                  {collectionLabelFor(activeWidget)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Suelta para reordenar
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!loading && widgets.length > 0 && !hasSystemWidget("quick_task") ? (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() =>
              void add({ id: "quick_task", kind: "quick_task" } as MyDayWidget)
            }
          >
            <PlusCircle aria-hidden="true" />
            Agregar creación rápida de tareas
          </Button>
        </div>
      ) : null}

      <AddWidgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        apiClient={apiClient}
        onAdd={add}
        saving={saving}
        existingKinds={existingKinds}
      />
    </section>
  );
}
