import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { accessMessages } from "@/i18n/locales/access";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  AccessControlClient,
  AuditFilters,
  AccessAuditDetail,
} from "@/api/access-control-client";

type Client = Pick<AccessControlClient, "listAudit" | "getAudit">;
const actionLabels = {
  "role.saved": "Role saved",
  "role.deleted": "Role deleted",
  "assignments.saved": "Assignments changed",
} as const;
const initialFilters = {
  action: "",
  actorId: "",
  targetId: "",
  from: "",
  to: "",
};
const dateLabel = (value: string, locale: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(locale);
};
const labelFor = (key: string) =>
  ({
    label: "Display name",
    name: "Role name",
    enabled: "Enabled",
    description: "Description",
    grants: "Permissions",
    value: "Assigned roles",
  })[key] ?? key;
function values(snapshot: unknown): Record<string, unknown> {
  if (snapshot === null || snapshot === undefined) return {};
  if (Array.isArray(snapshot))
    return {
      value: snapshot
        .map((item) =>
          typeof item === "object" && item && "role_id" in item
            ? item.role_id
            : item,
        )
        .sort(),
    };
  return typeof snapshot === "object"
    ? (snapshot as Record<string, unknown>)
    : { value: snapshot };
}
function Value({ value }: { value: unknown }) {
  const t = useMessages(accessMessages);
  const text =
    value === undefined
      ? t("Not recorded")
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-sm [overflow-wrap:anywhere]">
      {text}
    </pre>
  );
}
function AuditDetail({ entry }: { entry: AccessAuditDetail }) {
  const t = useMessages(accessMessages);
  const locale = intlLocale(useAppLocale());
  const before = values(entry.before),
    after = values(entry.after);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return (
    <div className="space-y-5">
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("Actor")}</dt>
          <dd className="break-words">
            {entry.actor.displayName || entry.actor.id}
          </dd>
          <dd className="break-all text-xs text-muted-foreground">
            {entry.actor.id}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Recorded at")}</dt>
          <dd>{dateLabel(entry.createdAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Target")}</dt>
          <dd className="break-all">{entry.targetId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Event ID")}</dt>
          <dd className="break-all">{entry.id}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("Only captured values are shown. Unchanged values are omitted.")}
      </p>
      {changed.length === 0 ? (
        <p>{t("No captured value differences.")}</p>
      ) : (
        changed.map((key) => (
          <section
            key={key}
            className="space-y-2"
            aria-label={
              labelFor(key) in accessMessages
                ? t(labelFor(key) as keyof typeof accessMessages)
                : key
            }
          >
            <h4 className="font-medium">
              {labelFor(key) in accessMessages
                ? t(labelFor(key) as keyof typeof accessMessages)
                : key}
            </h4>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-1 text-xs text-muted-foreground">
                  {t("Before")}
                </p>
                <Value value={before[key]} />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs text-muted-foreground">
                  {t("After")}
                </p>
                <Value value={after[key]} />
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
function AuditView({ scope, client }: { scope: string; client: Client }) {
  const t = useMessages(accessMessages);
  const locale = intlLocale(useAppLocale());
  const [draft, setDraft] = useState(initialFilters),
    [filters, setFilters] = useState<AuditFilters>({ limit: 25 });
  const [pages, setPages] = useState<Array<string | undefined>>([undefined]);
  const [selected, setSelected] = useState<string>(),
    [validation, setValidation] = useState("");
  const sourceButton = useRef<HTMLButtonElement | null>(null),
    detailHeading = useRef<HTMLHeadingElement>(null);
  const cursor = pages[pages.length - 1];
  const query = useQuery({
    queryKey: ["access-control", "audit", scope, filters, cursor],
    queryFn: () =>
      client.listAudit(scope, { ...filters, ...(cursor ? { cursor } : {}) }),
    retry: false,
    gcTime: 0,
  });
  const detail = useQuery({
    queryKey: ["access-control", "audit-detail", scope, selected],
    queryFn: () => client.getAudit(scope, selected!),
    enabled: Boolean(selected) && !query.isError,
    retry: false,
    gcTime: 0,
  });
  const status = (detail.error as { status?: number } | null)?.status;
  const historyError =
    query.error ?? ([401, 403].includes(status ?? 0) ? detail.error : null);
  useEffect(() => {
    if (selected) detailHeading.current?.focus();
  }, [selected]);
  const closeDetail = () => {
    setSelected(undefined);
    sourceButton.current?.focus();
  };
  function submit(event: FormEvent) {
    event.preventDefault();
    const from = draft.from ? new Date(draft.from) : undefined,
      to = draft.to ? new Date(draft.to) : undefined;
    if (
      (from && Number.isNaN(from.valueOf())) ||
      (to && Number.isNaN(to.valueOf()))
    ) {
      setValidation("Enter a valid date and time.");
      return;
    }
    if (from && to && from > to) {
      setValidation("Start must be before end.");
      return;
    }
    setValidation("");
    setSelected(undefined);
    setPages([undefined]);
    setFilters({
      limit: 25,
      ...(draft.action
        ? { action: draft.action as AuditFilters["action"] }
        : {}),
      ...(draft.actorId.trim() ? { actorId: draft.actorId.trim() } : {}),
      ...(draft.targetId.trim() ? { targetId: draft.targetId.trim() } : {}),
      ...(from ? { from: from.toISOString() } : {}),
      ...(to ? { to: to.toISOString() } : {}),
    });
  }
  const refresh = () => {
    setSelected(undefined);
    if (pages.length > 1) setPages([undefined]);
    else void query.refetch();
  };
  return (
    <section className="min-w-0 space-y-5" aria-label={t("Permission history")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("Permission history")}</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {t(
              "Review successful changes to roles and member access in this workspace.",
            )}
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={query.isFetching}>
          {t("Refresh history")}
        </Button>
      </div>
      <form
        onSubmit={submit}
        className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="grid gap-1.5 text-sm">
          {t("Action")}
          <select
            className="h-9 min-w-0 rounded-md border bg-background px-3"
            value={draft.action}
            onChange={(event) =>
              setDraft({ ...draft, action: event.target.value })
            }
          >
            <option value="">{t("All actions")}</option>
            {Object.entries(actionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {(["actorId", "targetId", "from", "to"] as const).map((key) => (
          <label key={key} className="grid min-w-0 gap-1.5 text-sm">
            {
              {
                actorId: t("Actor ID"),
                targetId: t("Target ID"),
                from: t("From"),
                to: t("To"),
              }[key]
            }
            <Input
              type={key === "from" || key === "to" ? "datetime-local" : "text"}
              value={draft[key]}
              maxLength={200}
              onChange={(event) =>
                setDraft({ ...draft, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t("Apply filters")}</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(initialFilters);
              setFilters({ limit: 25 });
              setPages([undefined]);
              setSelected(undefined);
              setValidation("");
            }}
          >
            {t("Clear filters")}
          </Button>
        </div>
      </form>
      {validation && (
        <p role="alert" className="text-sm text-destructive">
          {Object.hasOwn(accessMessages, validation)
            ? t(validation as keyof typeof accessMessages)
            : validation}
        </p>
      )}
      {historyError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">{historyError.message}</p>
          <Button variant="outline" onClick={refresh}>
            {t("Retry history")}
          </Button>
        </div>
      ) : query.isPending || query.isFetching || !query.data ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          {t("Loading history…")}
        </p>
      ) : (
        <>
          {query.data.data.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              {t("No permission changes match these filters.")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="block w-full text-left text-sm sm:table">
                <caption className="sr-only">
                  {t("Permission changes, newest first")}
                </caption>
                <thead className="hidden border-b bg-muted/40 sm:table-header-group">
                  <tr>
                    {[
                      t("Time"),
                      t("Action"),
                      t("Actor"),
                      t("Target"),
                      t("Details"),
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="px-3 py-3 font-medium"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {query.data.data.map((entry) => (
                    <tr
                      key={entry.id}
                      className="grid grid-cols-2 gap-x-3 gap-y-2 border-b p-3 last:border-b-0 sm:table-row sm:p-0"
                    >
                      <td className="col-span-2 whitespace-nowrap sm:px-3 sm:py-3">
                        <time dateTime={entry.createdAt}>
                          {dateLabel(entry.createdAt, locale)}
                        </time>
                      </td>
                      <td className="sm:px-3 sm:py-3">
                        {entry.action in actionLabels
                          ? t(
                              actionLabels[
                                entry.action as keyof typeof actionLabels
                              ],
                            )
                          : entry.action}
                      </td>
                      <td className="min-w-0 break-words sm:max-w-48 sm:px-3 sm:py-3">
                        {entry.actor.displayName || entry.actor.id}
                      </td>
                      <td className="col-span-2 min-w-0 break-all sm:max-w-52 sm:px-3 sm:py-3">
                        <span className="text-muted-foreground sm:hidden">
                          {t("Target:")}{" "}
                        </span>
                        {entry.targetId}
                      </td>
                      <td className="col-span-2 sm:px-3 sm:py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("View changes to %{target}", {
                            target: entry.targetId,
                          })}
                          aria-expanded={selected === entry.id}
                          onClick={(event) => {
                            sourceButton.current = event.currentTarget;
                            setSelected(entry.id);
                          }}
                        >
                          {t("View changes")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav
            aria-label={t("History pages")}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-sm text-muted-foreground">
              {t("Page %{page} · %{count} entries", {
                page: pages.length,
                count: query.data.data.length,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={pages.length === 1 || query.isFetching}
                onClick={() => {
                  setSelected(undefined);
                  setPages(pages.slice(0, -1));
                }}
              >
                {t("Previous page")}
              </Button>
              <Button
                variant="outline"
                disabled={!query.data.nextCursor || query.isFetching}
                onClick={() => {
                  setSelected(undefined);
                  setPages([...pages, query.data.nextCursor!]);
                }}
              >
                {t("Next page")}
              </Button>
            </div>
          </nav>
          {selected && (
            <section
              className="space-y-4 border-t pt-6"
              aria-label={t("Change details")}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3
                  ref={detailHeading}
                  tabIndex={-1}
                  className="text-lg font-semibold outline-offset-4"
                >
                  {t("Change details")}
                </h3>
                <Button variant="ghost" onClick={closeDetail}>
                  {t("Close details")}
                </Button>
              </div>
              {detail.isError ? (
                <div role="alert" className="space-y-2">
                  <p className="text-sm text-destructive">
                    {detail.error.message}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void detail.refetch()}
                  >
                    {t("Retry details")}
                  </Button>
                </div>
              ) : detail.isPending || detail.isFetching ? (
                <p role="status">{t("Loading changes…")}</p>
              ) : detail.data ? (
                <AuditDetail entry={detail.data} />
              ) : null}
            </section>
          )}
        </>
      )}
    </section>
  );
}
/** Remount query and selection state at scope boundaries; never reuse another scope's data. */
export default function AuditBrowser(props: { scope: string; client: Client }) {
  return <AuditView key={props.scope} {...props} />;
}
