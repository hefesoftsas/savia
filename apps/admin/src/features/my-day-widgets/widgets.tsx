import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeWidgetCollection,
  listWidgetRecords,
  listWidgetRecordsForReview,
  summarizeWidgetRecords,
  widgetDeepLink,
} from "./data";
import {
  actionBucketLabel,
  autoDetectWidgetConfig,
  bucketActionItems,
  formatWidgetAmount,
  formatWidgetCount,
  recordDateLabel,
  recordStatus,
  recordTitle,
} from "./summarize";
import { PluginWidgetBody } from "./plugin-widget";
import { parsePluginKind, pluginWidgetTitle } from "./plugins";
import { AgendaWidgetBody, QuickTaskWidgetBody } from "./agenda-widget";
import type { WidgetCollectionSchema } from "./types";

function WidgetError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert aria-label={message}>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function WidgetSkeleton() {
  return (
    <div role="status" aria-label="Cargando widget…" className="space-y-2">
      <span className="sr-only">Cargando widget…</span>
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function useWidgetSchema(
  apiClient: ApiClient | undefined,
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>,
) {
  const [schema, setSchema] = useState<WidgetCollectionSchema | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!apiClient) return;
    let active = true;
    void describeWidgetCollection(
      apiClient,
      widget.apiBasePath,
      widget.collection,
    ).then(
      (result) => {
        if (!active) return;
        if (result) setSchema(result);
        else setMissing(true);
      },
      () => {
        if (active) setMissing(true);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient, widget.apiBasePath, widget.collection]);
  return { schema, missing };
}

export function SummaryWidgetBody({
  apiClient,
  widget,
}: {
  apiClient: ApiClient | undefined;
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>;
}) {
  const [total, setTotal] = useState<number | null>(null);
  const [groups, setGroups] = useState<
    { value: string; count: number; amount: number }[] | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const { schema, missing } = useWidgetSchema(apiClient, widget);
  const detected = schema ? autoDetectWidgetConfig(schema) : {};
  const statusField = widget.config?.statusField ?? detected.statusField;
  const amountField = widget.config?.amountField ?? detected.amountField;
  const limit = widget.config?.limit ?? 5;

  useEffect(() => {
    if (!apiClient) return;
    // Wait for the schema so auto-detected group fields apply to
    // widgets saved without an explicit status field.
    if (schema === null && !missing) return;
    let active = true;
    setFailed(false);
    void (async () => {
      try {
        const effective: MyDayWidget = {
          ...widget,
          config: { ...widget.config, amountField },
        };
        const [page, breakdown] = await Promise.all([
          listWidgetRecords(apiClient, {
            ...widget,
            config: { ...widget.config, limit: 1 },
          }),
          statusField
            ? summarizeWidgetRecords(apiClient, effective, statusField)
            : Promise.resolve(null),
        ]);
        if (!active) return;
        setTotal(page.total);
        setGroups(breakdown);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiClient, widget, schema, missing, statusField, amountField, nonce]);

  if (!apiClient) return <WidgetSkeleton />;
  if (failed)
    return (
      <WidgetError
        message="No pudimos cargar este resumen."
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (total === null) return <WidgetSkeleton />;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">
          {formatWidgetCount(total)}
        </span>
        <span className="text-sm text-muted-foreground">registros</span>
      </div>
      {groups ? (
        <ul className="divide-y rounded-lg border">
          {groups.slice(0, limit).map((group) => (
            <li
              key={group.value}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {group.value}
              </span>
              {amountField ? (
                <span className="tabular-nums text-muted-foreground">
                  {formatWidgetAmount(group.amount)}
                </span>
              ) : null}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                {formatWidgetCount(group.count)}
              </span>
            </li>
          ))}
        </ul>
      ) : schema === null ? null : (
        <p className="text-sm text-muted-foreground">
          Sin campo de estado: muestra el total de la colección.
        </p>
      )}
    </div>
  );
}

export function ItemsWidgetBody({
  apiClient,
  widget,
}: {
  apiClient: ApiClient | undefined;
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>;
}) {
  const [records, setRecords] = useState<
    { id: string; title: string; status?: string; date?: string }[] | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const { schema, missing } = useWidgetSchema(apiClient, widget);

  useEffect(() => {
    if (!apiClient) return;
    let active = true;
    setFailed(false);
    void listWidgetRecords(apiClient, widget).then(
      (page) => {
        if (!active) return;
        setRecords(
          page.data.map((record) => ({
            id: String(record.id),
            title: recordTitle(record, schema ?? undefined),
            status:
              recordStatus(record, widget.config?.statusField) ?? undefined,
            date:
              recordDateLabel(record, widget.config?.dateField) ?? undefined,
          })),
        );
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient, widget, schema, nonce]);

  if (!apiClient) return <WidgetSkeleton />;
  if (missing)
    return (
      <p className="text-sm text-muted-foreground">
        Esta colección ya no está disponible. Quítala del tablero.
      </p>
    );
  if (failed)
    return (
      <WidgetError
        message="No pudimos cargar estos elementos."
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (records === null) return <WidgetSkeleton />;
  if (records.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay registros en esta colección.
      </p>
    );

  return (
    <ul className="divide-y rounded-lg border">
      {records.map((record) => (
        <li key={record.id} className="px-3 py-2">
          <p className="truncate text-sm font-medium">{record.title}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {record.status ? <span>{record.status}</span> : null}
            {record.date ? <span>{record.date}</span> : null}
            {!record.status && !record.date ? <span>Sin detalle</span> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ChartWidgetBody({
  apiClient,
  widget,
}: {
  apiClient: ApiClient | undefined;
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>;
}) {
  const [groups, setGroups] = useState<
    { value: string; count: number; amount: number }[] | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const { schema, missing } = useWidgetSchema(apiClient, widget);
  const detected = schema ? autoDetectWidgetConfig(schema) : {};
  const groupField = widget.config?.groupField ?? detected.statusField;
  const amountField = widget.config?.amountField ?? detected.amountField;
  const limit = widget.config?.limit ?? 5;

  useEffect(() => {
    if (!apiClient || !groupField) return;
    if (schema === null && !missing) return;
    let active = true;
    setFailed(false);
    void summarizeWidgetRecords(
      apiClient,
      { ...widget, config: { ...widget.config, amountField } },
      groupField,
      undefined,
    ).then(
      (breakdown) => {
        if (active) setGroups(breakdown);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient, widget, schema, missing, groupField, amountField, nonce]);

  if (!apiClient) return <WidgetSkeleton />;
  if (missing || (schema && !groupField))
    return (
      <p className="text-sm text-muted-foreground">
        Esta colección no tiene campo de agrupación para graficar. Prueba con un
        resumen o elementos.
      </p>
    );
  if (failed)
    return (
      <WidgetError
        message="No pudimos cargar esta gráfica."
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (groups === null) return <WidgetSkeleton />;
  if (groups.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Sin datos para graficar todavía.
      </p>
    );

  const visible = groups.slice(0, limit);
  const max = Math.max(1, ...visible.map((group) => group.count));

  return (
    <ul className="space-y-2.5">
      {visible.map((group) => (
        <li key={group.value}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">
              {group.value}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {amountField ? `${formatWidgetAmount(group.amount)} · ` : ""}
              {formatWidgetCount(group.count)}
            </span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${group.value}: ${group.count}`}
          >
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.round((group.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ActionsWidgetBody({
  apiClient,
  widget,
}: {
  apiClient: ApiClient | undefined;
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>;
}) {
  const [items, setItems] = useState<
    | {
        id: string;
        title: string;
        day: string;
        bucket: "overdue" | "today" | "week";
      }[]
    | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const { schema, missing } = useWidgetSchema(apiClient, widget);
  const detected = schema ? autoDetectWidgetConfig(schema) : {};
  const dateField = widget.config?.dateField ?? detected.dateField;
  const limit = widget.config?.limit ?? 5;

  useEffect(() => {
    if (!apiClient || !dateField) return;
    if (schema === null && !missing) return;
    let active = true;
    setFailed(false);
    void listWidgetRecordsForReview(apiClient, widget, dateField).then(
      (page) => {
        if (!active) return;
        setItems(
          bucketActionItems(page.data, dateField).map((entry) => ({
            id: String(entry.record.id),
            title: recordTitle(entry.record, schema ?? undefined),
            day: entry.day,
            bucket: entry.bucket,
          })),
        );
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient, widget, schema, missing, dateField, nonce]);

  if (!apiClient) return <WidgetSkeleton />;
  if (missing)
    return (
      <p className="text-sm text-muted-foreground">
        Esta colección ya no está disponible. Quítala del tablero.
      </p>
    );
  if (!dateField && schema)
    return (
      <p className="text-sm text-muted-foreground">
        Esta colección no tiene campo de fecha para detectar vencimientos.
      </p>
    );
  if (failed)
    return (
      <WidgetError
        message="No pudimos cargar estas acciones."
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (items === null) return <WidgetSkeleton />;
  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Al día: nada vence en los próximos 7 días.
      </p>
    );

  const overdue = items.filter((item) => item.bucket === "overdue").length;

  return (
    <div className="space-y-3">
      {overdue > 0 ? (
        <p className="text-sm font-medium text-destructive">
          {overdue} {overdue === 1 ? "vencido" : "vencidos"}
        </p>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {items.slice(0, limit).map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {item.day}
              </p>
            </div>
            <Badge
              variant={
                item.bucket === "overdue"
                  ? "destructive"
                  : item.bucket === "today"
                    ? "default"
                    : "secondary"
              }
              className="shrink-0"
            >
              {actionBucketLabel(item.bucket)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

const widgetKindLabels: Record<string, string> = {
  summary: "Resumen",
  items: "Elementos",
  chart: "Gráfica",
  actions: "Acciones",
  agenda: "Agenda",
  quick_task: "Tarea rápida",
};

function isBuiltInWidget(widget: MyDayWidget): boolean {
  return (
    widget.kind === "summary" ||
    widget.kind === "items" ||
    widget.kind === "chart" ||
    widget.kind === "actions"
  );
}

function isCollectionWidget(
  widget: MyDayWidget,
): widget is Extract<MyDayWidget, { apiBasePath: string }> {
  return "apiBasePath" in widget && "collection" in widget;
}

export function WidgetCard({
  apiClient,
  widget,
  collectionLabel,
  agenda,
  quickTask,
  onRemove,
  onMove,
  isFirst,
  isLast,
  disabled,
  dragHandle,
}: {
  apiClient: ApiClient | undefined;
  widget: MyDayWidget;
  collectionLabel: string;
  agenda?: React.ComponentProps<typeof AgendaWidgetBody>;
  quickTask?: React.ComponentProps<typeof QuickTaskWidgetBody>;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  dragHandle?: React.ReactNode;
}) {
  const title = widget.title ?? collectionLabel;
  const pluginTitle =
    typeof widget.kind === "string"
      ? pluginWidgetTitle(widget.kind)
      : undefined;
  const isPlugin =
    typeof widget.kind === "string" && parsePluginKind(widget.kind) !== null;
  const isSystem = widget.kind === "agenda" || widget.kind === "quick_task";
  const supported = isBuiltInWidget(widget) || isSystem || isPlugin;

  return (
    <Card
      data-testid={`my-day-widget-${widget.id}`}
      className="rounded-2xl border-border/60 shadow-sm transition-shadow hover:shadow-md"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="flex min-w-0 items-start gap-1.5">
          {dragHandle}
          <div className="min-w-0">
            <CardTitle className="truncate text-[15px] font-semibold tracking-tight">
              {title}
            </CardTitle>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {collectionLabel} ·{" "}
              {pluginTitle ?? widgetKindLabels[widget.kind] ?? "Vista previa"}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              aria-label={`Opciones del widget ${title}`}
              disabled={disabled}
            >
              ⋯
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isCollectionWidget(widget) ? (
              <DropdownMenuItem asChild>
                <a href={widgetDeepLink(widget)}>Abrir colección</a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={isFirst}
              onSelect={() => onMove(widget.id, -1)}
            >
              Mover antes
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isLast}
              onSelect={() => onMove(widget.id, 1)}
            >
              Mover después
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onRemove(widget.id)}
              className="text-destructive"
            >
              Quitar widget
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="pt-0">
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            Este tipo de widget estará disponible próximamente. Mientras tanto
            puedes abrir la colección completa.
          </p>
        ) : widget.kind === "agenda" ? (
          agenda ? (
            <AgendaWidgetBody agenda={agenda.agenda} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Conecta tu calendario para ver tu agenda aquí.
            </p>
          )
        ) : widget.kind === "quick_task" ? (
          quickTask ? (
            <QuickTaskWidgetBody
              agenda={quickTask.agenda}
              personalIntegrations={quickTask.personalIntegrations}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Conecta tu calendario para crear tareas aquí.
            </p>
          )
        ) : isPlugin && isCollectionWidget(widget) ? (
          <PluginWidgetBody apiClient={apiClient} widget={widget} />
        ) : widget.kind === "summary" && isCollectionWidget(widget) ? (
          <SummaryWidgetBody apiClient={apiClient} widget={widget} />
        ) : widget.kind === "items" && isCollectionWidget(widget) ? (
          <ItemsWidgetBody apiClient={apiClient} widget={widget} />
        ) : widget.kind === "chart" && isCollectionWidget(widget) ? (
          <ChartWidgetBody apiClient={apiClient} widget={widget} />
        ) : isCollectionWidget(widget) ? (
          <ActionsWidgetBody apiClient={apiClient} widget={widget} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No pudimos mostrar este widget.
          </p>
        )}
      </CardContent>
      {isCollectionWidget(widget) ? (
        <CardFooter className="pt-1">
          <a
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            href={widgetDeepLink(widget)}
            aria-label={`Ver ${collectionLabel} completa`}
          >
            Ver todo <ExternalLink className="size-3.5" />
          </a>
        </CardFooter>
      ) : null}
    </Card>
  );
}
