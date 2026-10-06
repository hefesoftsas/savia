import { MailWidgetBody } from "./mail-widget";
import type { MailState } from "./use-my-day-mail";
import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { matchTenantApiBasePath } from "@/features/studio/studio-navigation";
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
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
  autoDetectWidgetConfig,
  bucketActionItems,
  recordStatus,
  recordTitle,
} from "./summarize";
import { PluginWidgetBody } from "./plugin-widget";
import { parsePluginKind, pluginContributionFor } from "./plugins";
import { AgendaWidgetBody, QuickTaskWidgetBody } from "./agenda-widget";
import { OfficeDocumentsWidgetBody } from "./office-documents-widget";
import type { WidgetCollectionSchema, WidgetRecord } from "./types";
import { widgetMessages } from "./widget-messages";

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    value,
  );
}

function formatRecordDate(
  record: WidgetRecord,
  dateField: string | undefined,
  locale: string,
): string | undefined {
  const raw =
    (dateField ? record[dateField] : undefined) ??
    record.updated_at ??
    record.created_at;
  if (typeof raw !== "string" || !raw) return undefined;
  const date = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  return Number.isNaN(date.getTime())
    ? undefined
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function formatActionDay(day: string, locale: string): string {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? day
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function WidgetError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useMessages(widgetMessages);
  return (
    <Alert aria-label={message}>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          {t("Retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function WidgetSkeleton() {
  const t = useMessages(widgetMessages);
  return (
    <div role="status" aria-label={t("Loading widget…")} className="space-y-2">
      <span className="sr-only">{t("Loading widget…")}</span>
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
  const [revision, setRevision] = useState(0);
  const tenantId = matchTenantApiBasePath(widget.apiBasePath);
  useRealtimeRefresh({
    topics: ["studio"],
    tenantId: Number(tenantId),
    enabled: tenantId !== undefined,
    refresh: () => setRevision((value) => value + 1),
  });
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
        setSchema(result ?? null);
        setMissing(!result);
      },
      () => {
        if (active) setMissing(true);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient, widget.apiBasePath, widget.collection, revision]);
  return { schema, missing };
}

export function SummaryWidgetBody({
  apiClient,
  widget,
}: {
  apiClient: ApiClient | undefined;
  widget: Extract<MyDayWidget, { apiBasePath: string; collection: string }>;
}) {
  const t = useMessages(widgetMessages);
  const uiLocale = intlLocale(useAppLocale());
  const [total, setTotal] = useState<number | null>(null);
  const [groups, setGroups] = useState<
    { value: string; count: number; amount: number }[] | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tenantId = matchTenantApiBasePath(widget.apiBasePath);
  useRealtimeRefresh({
    topics: ["records"],
    tenantId: Number(tenantId),
    enabled: tenantId !== undefined,
    accepts: (event) => event.collection === widget.collection,
    refresh: () => setNonce((value) => value + 1),
  });
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
        message={t("Could not load this summary.")}
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (total === null) return <WidgetSkeleton />;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">
          {formatCount(total, uiLocale)}
        </span>
        <span className="text-sm text-muted-foreground">{t("records")}</span>
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
                  {formatAmount(group.amount, uiLocale)}
                </span>
              ) : null}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                {formatCount(group.count, uiLocale)}
              </span>
            </li>
          ))}
        </ul>
      ) : schema === null ? null : (
        <p className="text-sm text-muted-foreground">
          {t("No status field: showing the collection total.")}
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
  const t = useMessages(widgetMessages);
  const uiLocale = intlLocale(useAppLocale());
  const [records, setRecords] = useState<
    { id: string; title: string; status?: string; date?: string }[] | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tenantId = matchTenantApiBasePath(widget.apiBasePath);
  useRealtimeRefresh({
    topics: ["records"],
    tenantId: Number(tenantId),
    enabled: tenantId !== undefined,
    accepts: (event) => event.collection === widget.collection,
    refresh: () => setNonce((value) => value + 1),
  });
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
            date: formatRecordDate(record, widget.config?.dateField, uiLocale),
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
        {t(
          "This collection is no longer available. Remove it from your dashboard.",
        )}
      </p>
    );
  if (failed)
    return (
      <WidgetError
        message={t("Could not load these items.")}
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (records === null) return <WidgetSkeleton />;
  if (records.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("There are no records in this collection yet.")}
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
            {!record.status && !record.date ? (
              <span>{t("No details")}</span>
            ) : null}
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
  const t = useMessages(widgetMessages);
  const uiLocale = intlLocale(useAppLocale());
  const [groups, setGroups] = useState<
    { value: string; count: number; amount: number }[] | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tenantId = matchTenantApiBasePath(widget.apiBasePath);
  useRealtimeRefresh({
    topics: ["records"],
    tenantId: Number(tenantId),
    enabled: tenantId !== undefined,
    accepts: (event) => event.collection === widget.collection,
    refresh: () => setNonce((value) => value + 1),
  });
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
        {t(
          "This collection has no grouping field for a chart. Try a summary or items widget.",
        )}
      </p>
    );
  if (failed)
    return (
      <WidgetError
        message={t("Could not load this chart.")}
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (groups === null) return <WidgetSkeleton />;
  if (groups.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("No data to chart yet.")}
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
              {amountField ? `${formatAmount(group.amount, uiLocale)} · ` : ""}
              {formatCount(group.count, uiLocale)}
            </span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${group.value}: ${formatCount(group.count, uiLocale)}`}
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
  const locale = useAppLocale();
  const uiLocale = intlLocale(locale);
  const t = useMessages(widgetMessages);
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
  const tenantId = matchTenantApiBasePath(widget.apiBasePath);
  useRealtimeRefresh({
    topics: ["records"],
    tenantId: Number(tenantId),
    enabled: tenantId !== undefined,
    accepts: (event) => event.collection === widget.collection,
    refresh: () => setNonce((value) => value + 1),
  });
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
        {t(
          "This collection is no longer available. Remove it from your dashboard.",
        )}
      </p>
    );
  if (!dateField && schema)
    return (
      <p className="text-sm text-muted-foreground">
        {t("This collection has no date field for due dates.")}
      </p>
    );
  if (failed)
    return (
      <WidgetError
        message={t("Could not load these actions.")}
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (items === null) return <WidgetSkeleton />;
  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("Nothing is due in the next 7 days.")}
      </p>
    );

  const overdue = items.filter((item) => item.bucket === "overdue").length;

  return (
    <div className="space-y-3">
      {overdue > 0 ? (
        <p className="text-sm font-medium text-destructive">
          {new Intl.NumberFormat(uiLocale).format(overdue)}{" "}
          {overdue === 1 ? t("overdue_one") : t("overdue_many")}
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
                {formatActionDay(item.day, uiLocale)}
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
              {t(
                item.bucket === "overdue"
                  ? "Overdue"
                  : item.bucket === "today"
                    ? "Today"
                    : "This week",
              )}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  mail,
  onCompose,
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
  mail?: MailState;
  onCompose?: () => void;
  agenda?: React.ComponentProps<typeof AgendaWidgetBody>;
  quickTask?: React.ComponentProps<typeof QuickTaskWidgetBody>;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  dragHandle?: React.ReactNode;
}) {
  const locale = useAppLocale();
  const t = useMessages(widgetMessages);
  const title = widget.title ?? collectionLabel;
  const pluginRef =
    typeof widget.kind === "string" ? parsePluginKind(widget.kind) : null;
  const pluginContribution = pluginRef
    ? pluginContributionFor(pluginRef)
    : undefined;
  const pluginTitle = pluginContribution
    ? (pluginContribution.title[locale] ?? pluginContribution.title.es)
    : undefined;
  const kindLabel =
    widget.kind === "summary"
      ? t("Summary")
      : widget.kind === "items"
        ? t("Items")
        : widget.kind === "chart"
          ? t("Chart")
          : widget.kind === "actions"
            ? t("Actions")
            : widget.kind === "agenda"
              ? t("Agenda")
              : widget.kind === "quick_task"
                ? t("Quick task")
                : widget.kind === "mail"
                  ? t("Inbox")
                  : widget.kind === "office_documents"
                    ? t("Office documents")
                    : t("Preview");
  const isPlugin =
    typeof widget.kind === "string" && parsePluginKind(widget.kind) !== null;
  const isSystem =
    widget.kind === "agenda" ||
    widget.kind === "quick_task" ||
    widget.kind === "mail" ||
    widget.kind === "office_documents";
  const supported = isBuiltInWidget(widget) || isSystem || isPlugin;

  return (
    <Card
      data-testid={`my-day-widget-${widget.id}`}
      className="min-w-0 gap-3 rounded-2xl border-border/60 py-4 shadow-sm transition-shadow hover:shadow-md sm:gap-6 sm:py-6"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 px-4 pb-0 sm:px-6 sm:pb-3">
        <div className="flex min-w-0 items-start gap-1.5">
          {dragHandle}
          <div className="min-w-0">
            <CardTitle className="truncate text-[15px] font-semibold tracking-tight">
              {title}
            </CardTitle>
            <p
              className={`mt-0.5 truncate text-xs text-muted-foreground ${isSystem ? "hidden" : ""}`}
            >
              {collectionLabel} · {pluginTitle ?? kindLabel}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground max-sm:size-11"
              aria-label={t("Widget options for %{title}", { title })}
              disabled={disabled}
            >
              ⋯
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isCollectionWidget(widget) ? (
              <DropdownMenuItem asChild>
                <a href={widgetDeepLink(widget)}>{t("Open collection")}</a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={isFirst}
              onSelect={() => onMove(widget.id, -1)}
            >
              {t("Move before")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isLast}
              onSelect={() => onMove(widget.id, 1)}
            >
              {t("Move after")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onRemove(widget.id)}
              className="text-destructive"
            >
              {t("Remove widget")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="px-4 pt-0 sm:px-6">
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            {t(
              "This widget type will be available soon. In the meantime, open the full collection.",
            )}
          </p>
        ) : widget.kind === "mail" && mail ? (
          <MailWidgetBody mail={mail} onCompose={onCompose ?? (() => {})} />
        ) : widget.kind === "agenda" ? (
          agenda ? (
            <AgendaWidgetBody agenda={agenda.agenda} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("Connect your calendar to see your agenda here.")}
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
              {t("Connect your calendar to create tasks here.")}
            </p>
          )
        ) : widget.kind === "office_documents" ? (
          <OfficeDocumentsWidgetBody apiClient={apiClient} />
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
            {t("Could not show this widget.")}
          </p>
        )}
      </CardContent>
      {isCollectionWidget(widget) ? (
        <CardFooter className="pt-1">
          <a
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            href={widgetDeepLink(widget)}
            aria-label={t("View all %{collection}", {
              collection: collectionLabel,
            })}
          >
            {t("View all")} <ExternalLink className="size-3.5" />
          </a>
        </CardFooter>
      ) : null}
    </Card>
  );
}
