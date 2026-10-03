import {
  useMyDayMail,
  isMailClient,
  mailProviderLabel,
  type PersonalMailLike,
} from "./use-my-day-mail";
import { MailComposer } from "./mail-composer";
import {
  useRealtimeRefresh,
  RemoteChangesNotice,
} from "@/realtime/use-realtime-refresh";
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
import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddWidgetDialog } from "./add-widget-dialog";
import {
  AgendaWidgetBody,
  QuickTaskWidgetBody,
  useMyDayAgenda,
  type AgendaState,
  type PersonalIntegrationsLike,
} from "./agenda-widget";
import { listWidgetCollections } from "./data";
import { useMyDayWidgets } from "./use-my-day-widgets";
import { WidgetCard } from "./widgets";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";
import { useEffect } from "react";
import { widgetMessages } from "./widget-messages";

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
    const apiBasePaths = [
      ...new Set(collectionWidgets.map((widget) => widget.apiBasePath)),
    ];
    void Promise.allSettled(
      apiBasePaths.map((apiBasePath) =>
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
  if (widget.kind === "agenda" || widget.kind === "mail")
    return "md:col-span-2 xl:col-span-2";
  return "";
}

function SortableWidgetItem({
  widget,
  children,
  disabled,
  expanded,
}: {
  widget: MyDayWidget;
  children: (handleProps: {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
  }) => React.ReactNode;
  disabled: boolean;
  expanded?: boolean;
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
      className={`min-w-0 ${expanded ? "md:col-span-2 xl:col-span-3" : widgetSpanClass(widget)} ${isDragging ? "opacity-40" : ""}`}
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
  agenda: agendaProp,
}: {
  apiClient?: ApiClient;
  userPreferences?: UserPreferencesClient;
  personalIntegrations?: PersonalIntegrationsLike & Partial<PersonalMailLike>;
  agenda?: AgendaState;
}) {
  const locale = useAppLocale();
  const uiLocale = intlLocale(locale);
  const t = useMessages(widgetMessages);
  const [dialogOpen, setDialogOpen] = useState(false);
  const {
    widgets,
    loading,
    saving,
    feedback,
    unavailable,
    setFeedback,
    add,
    remove,
    reorder,
    reload,
    hasSystemWidget,
  } = useMyDayWidgets(userPreferences);
  const mailClient = isMailClient(personalIntegrations)
    ? personalIntegrations
    : undefined;
  const mail = useMyDayMail(mailClient);
  const [composeOpen, setComposeOpen] = useState(false);
  useEffect(() => {
    setComposeOpen(false);
  }, [mail.sessionRevision, mailClient]);
  const visibleWidgets = useMemo(
    () =>
      widgets.filter(
        (widget) => widget.kind !== "mail" || mail.connections.length > 0,
      ),
    [widgets, mail.connections.length],
  );
  const labels = useCollectionLabels(apiClient, widgets);
  // La página ya posee una instancia (header): reutilizarla evita duplicar
  // /connections y /events x2 en el mismo ms.
  const fallbackAgenda = useMyDayAgenda(
    agendaProp ? undefined : personalIntegrations,
  );
  const agenda = agendaProp ?? fallbackAgenda;
  const [activeId, setActiveId] = useState<string | null>(null);

  const remoteLayout = useRealtimeRefresh({
    topics: ["account"],
    blocked: saving || dialogOpen || Boolean(activeId),
    refresh: async () => {
      setDialogOpen(false);
      setActiveId(null);
      await reload();
    },
    accepts: (event) => !event.collection || event.collection === "preferences",
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortableIds = useMemo(
    () => visibleWidgets.map((widget) => widget.id),
    [visibleWidgets],
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
    void reorder(String(active.id), String(over.id), sortableIds);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  function collectionLabelFor(widget: MyDayWidget): string {
    if (!("apiBasePath" in widget) || !("collection" in widget)) {
      if (widget.kind === "agenda") return t("Agenda");
      if (widget.kind === "quick_task") return t("Quick task");
      if (widget.kind === "mail") return t("Mail inbox");
      if (widget.kind === "office_documents") return t("Office documents");
      return widget.title ?? widget.kind;
    }
    return (
      labels[`${widget.apiBasePath}:${widget.collection}`] ??
      widget.title ??
      widget.collection
    );
  }

  return (
    <section aria-label={t("My widgets")} className="mt-8">
      <RemoteChangesNotice {...remoteLayout} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <LayoutGrid className="size-4 text-primary" aria-hidden="true" />
          </span>
          <h2 className="text-xl font-semibold tracking-tight">
            {t("My dashboard")}
          </h2>
          {!loading && visibleWidgets.length > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {new Intl.NumberFormat(uiLocale).format(visibleWidgets.length)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hasSystemWidget("agenda") && !loading ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || full}
              onClick={() =>
                void add({ id: "agenda", kind: "agenda" } as MyDayWidget)
              }
            >
              <CalendarDays aria-hidden="true" />
              {t("Show agenda")}
            </Button>
          ) : null}
          {!hasSystemWidget("mail") &&
          mail.connections.length > 0 &&
          !loading ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || full}
              onClick={() => void add({ id: "mail", kind: "mail" })}
            >
              {t("Show mail")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || saving}
            onClick={() => {
              void agenda.refresh();
              void mail.refresh();
              void reload();
            }}
          >
            <RefreshCw
              className={loading ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            {t("Refresh")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || saving || full}
            onClick={() => setDialogOpen(true)}
          >
            <Plus aria-hidden="true" />
            {t("Add widget")}
          </Button>
        </div>
      </div>

      {mailClient &&
      (mail.reconnectRequired.length > 0 ||
        (!mail.connections.length && mail.errors.length > 0)) ? (
        <div className="mb-4 space-y-2" role="alert">
          {mail.reconnectRequired.map((provider) => (
            <p key={provider} className="text-sm">
              {t("Reconnect %{provider} to see your mail.", {
                provider: mailProviderLabel(provider),
              })}
            </p>
          ))}
          {!mail.connections.length
            ? mail.errors.map((error) => (
                <p key={error} className="text-sm text-destructive">
                  {error}
                </p>
              ))
            : null}
          <div className="flex flex-wrap gap-3">
            <a
              href="/my-integrations"
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("Review connections")}
            </a>
            {mail.errors.length ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={mail.loading}
                onClick={() => void mail.refresh()}
              >
                {t("Retry mail")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {agenda.feedback &&
      !(agenda.isCalendarConnectNotice && agenda.sources.sources.length > 0) ? (
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
                if (agenda.isCalendarConnectNotice) {
                  agenda.dismissConnectNotice();
                } else {
                  agenda.setFeedback(null);
                }
              }}
              aria-label={t("Close notice")}
              title={t("Close notice")}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </Alert>
      ) : null}
      {feedback ? (
        <Alert className="mb-4" aria-label={feedback}>
          <div className="col-start-2 flex min-w-0 items-start gap-2">
            <AlertDescription className="min-w-0 flex-1">
              {feedback}
            </AlertDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => setFeedback(null)}
              aria-label={t("Close notice")}
              title={t("Close notice")}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </Alert>
      ) : null}

      {loading ? (
        <div
          className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-label={t("Loading widgets…")}
        >
          <span className="sr-only">{t("Loading widgets…")}</span>
          {/* Misma retícula y alturas que el contenido final (la agenda ocupa
              2 columnas y min-h-44): evita el salto del grid a los ~7s. */}
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className={
                index === 0
                  ? "min-h-44 space-y-2 rounded-2xl border border-border/60 bg-card p-5 shadow-sm md:col-span-2 xl:col-span-2"
                  : "min-h-44 space-y-2 rounded-2xl border border-border/60 bg-card p-5 shadow-sm"
              }
            >
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : visibleWidgets.length === 0 ? (
        <div
          className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-gradient-to-b from-muted/60 to-muted/20 px-6 py-12 text-center shadow-sm"
          data-testid="my-day-widgets-empty"
        >
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <Boxes aria-hidden="true" className="size-7 text-primary" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-foreground">
            {t("Build your day")}
          </h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {t(
              "Add your agenda and collection widgets to see summaries, due dates, and recent items without opening each screen. Drag to reorder, remove, and add them again whenever you want.",
            )}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDialogOpen(true)}
            >
              <Plus aria-hidden="true" />
              {t("Add your first widget")}
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
              {t("Show agenda")}
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
              {visibleWidgets.map((widget, index) => (
                <SortableWidgetItem
                  key={widget.id}
                  widget={widget}
                  disabled={saving}
                  expanded={widget.kind === "agenda" && agenda.view !== "day"}
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
                      mail={widget.kind === "mail" ? mail : undefined}
                      onCompose={() => setComposeOpen(true)}
                      onRemove={(id) => void remove(id)}
                      onMove={(id, direction) => {
                        const target =
                          sortableIds[sortableIds.indexOf(id) + direction];
                        if (target) void reorder(id, target, sortableIds);
                      }}
                      isFirst={index === 0}
                      isLast={index === visibleWidgets.length - 1}
                      disabled={saving}
                      dragHandle={
                        <button
                          type="button"
                          aria-label={t("Drag widget %{title}", {
                            title: collectionLabelFor(widget),
                          })}
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
                  {t("Drop to reorder")}
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!loading &&
      visibleWidgets.length > 0 &&
      !hasSystemWidget("quick_task") ? (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving || full}
            onClick={() =>
              void add({ id: "quick_task", kind: "quick_task" } as MyDayWidget)
            }
          >
            <PlusCircle aria-hidden="true" />
            {t("Add quick task creation")}
          </Button>
        </div>
      ) : null}

      {mailClient ? (
        <MailComposer
          key={mail.sessionRevision}
          open={composeOpen}
          onSent={() => setFeedback({ key: "Email sent." })}
          onOpenChange={(open) => {
            setComposeOpen(open);
            if (!open && composeOpen) void mail.refresh();
          }}
          apiClient={apiClient}
          personalIntegrations={mailClient}
          connections={mail.connections}
          sessionRevision={mail.sessionRevision}
        />
      ) : null}
      <AddWidgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        apiClient={apiClient}
        onAdd={add}
        saving={saving}
        existingKinds={existingKinds}
        mailAvailable={mail.connections.length > 0}
      />
    </section>
  );
}
