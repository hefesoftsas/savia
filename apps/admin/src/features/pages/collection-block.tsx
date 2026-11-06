import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { pagesMessages } from "./messages";
export type CollectionReference = {
  domain: string;
  collection: string;
  mode: "table" | "pipeline";
  viewId?: string;
};
type Field = {
  label?: string;
  type: string;
  options?: Array<{ value: string; label: string }>;
  hidden?: boolean;
};
type Row = { id: string; [key: string]: unknown };
type Schema = {
  label: string;
  config: {
    fields: Record<string, Field>;
    fieldOrder?: string[];
    studio?: { pipeline?: { field: string } };
  };
};
export function collectionHref(
  ref: { domain: string; collection: string },
  record?: string,
) {
  const tenantId = /^\/v1\/studio\/(\d+)$/.exec(ref.domain)?.[1];
  if (!tenantId) return "#/studio";
  return `#/studio?${new URLSearchParams({ tenantId, object: ref.collection, ...(record ? { record } : {}) })}`;
}
const display = (value: unknown) =>
  typeof value === "object" && value !== null ? "—" : String(value ?? "—");
export function CollectionBlock({
  reference,
  api,
}: {
  reference: CollectionReference;
  api: ApiClient;
}) {
  const t = useMessages(pagesMessages);
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{
    schema: Schema;
    rows: Row[];
    total: number;
    columns: string[];
    group: string;
  } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    if (
      !/^\/v1\/studio\/\d+$/.test(reference.domain) ||
      !reference.collection
    ) {
      setError(true);
      return;
    }
    const base = `${reference.domain}/api`,
      name = encodeURIComponent(reference.collection);
    const options = { signal: controller.signal };
    void (async () => {
      const objects = await api.get<{ data: Array<Schema & { name: string }> }>(
        `${base}/objects`,
        options,
      );
      const schema = objects.data.find((o) => o.name === reference.collection);
      if (!schema) throw new Error("Collection unavailable");
      const views = reference.viewId
        ? await api.get<{
            data: Array<{
              id: string;
              config: {
                q?: string;
                searchField?: string;
                filters?: unknown;
                stage?: string;
                columns?: string[];
                sort?: { field: string; order: string };
                group?: string;
              };
            }>;
          }>(`${base}/views/${name}`, options)
        : { data: [] };
      const view = views.data.find((v) => v.id === reference.viewId)?.config;
      if (reference.viewId && !view) throw new Error("View unavailable");
      const params = new URLSearchParams({
        page: String(page),
        perPage: "20",
        sort: view?.sort?.field ?? "updated_at",
        order: view?.sort?.order ?? "DESC",
      });
      if (view?.q) params.set("q", view.q);
      if (view?.searchField) params.set("searchField", view.searchField);
      if (view?.filters) params.set("filters", JSON.stringify(view.filters));
      if (view?.stage) params.set("stage", view.stage);
      const rows = await api.get<{ data: Row[]; total: number }>(
        `${base}/records/${name}?${params}`,
        options,
      );
      const columns = (
        view?.columns ??
        schema.config.fieldOrder ??
        Object.keys(schema.config.fields)
      )
        .filter(
          (key) =>
            schema.config.fields[key] && !schema.config.fields[key].hidden,
        )
        .slice(0, 5);
      const group =
        view?.group ||
        schema.config.studio?.pipeline?.field ||
        Object.keys(schema.config.fields).find(
          (key) => schema.config.fields[key].type === "Dropdown",
        ) ||
        "";
      if (!controller.signal.aborted)
        setData({ schema, rows: rows.data, total: rows.total, columns, group });
    })().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [
    api,
    reference.domain,
    reference.collection,
    reference.viewId,
    page,
    refresh,
  ]);
  return (
    <section className="page-collection" aria-label={t("Collection")}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <a
          className="font-medium underline-offset-4 hover:underline"
          href={collectionHref(reference)}
        >
          {data?.schema.label ?? reference.collection} ↗
        </a>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRefresh((n) => n + 1)}
        >
          {t("Refresh")}
        </Button>
      </header>
      {error ? (
        <p role="alert">{t("Unavailable")}</p>
      ) : !data ? (
        <p role="status">{t("Loading")}</p>
      ) : (
        <>
          {!data.rows.length ? (
            <p className="py-6 text-muted-foreground">{t("No records")}</p>
          ) : reference.mode === "pipeline" && data.group ? (
            <div className="flex gap-4 overflow-x-auto pb-3">
              {[...new Set(data.rows.map((r) => display(r[data.group])))].map(
                (group) => (
                  <section key={group} className="min-w-52 flex-1">
                    <h4 className="mb-3 text-sm font-medium">
                      {data.schema.config.fields[data.group]?.options?.find(
                        (o) => o.value === group,
                      )?.label ?? group}
                    </h4>
                    <ul className="space-y-2">
                      {data.rows
                        .filter((r) => display(r[data.group]) === group)
                        .map((row) => (
                          <li key={row.id} className="border-b py-3">
                            <RecordLinks
                              row={row}
                              reference={reference}
                              title={display(row[data.columns[0]])}
                            />
                          </li>
                        ))}
                    </ul>
                  </section>
                ),
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {data.columns.map((key) => (
                      <th className="border-b px-3 py-2 font-medium" key={key}>
                        {data.schema.config.fields[key].label ?? key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      {data.columns.map((key, i) => (
                        <td
                          key={key}
                          className="max-w-64 truncate border-b px-3 py-3"
                        >
                          {i === 0 ? (
                            <RecordLinks
                              row={row}
                              reference={reference}
                              title={display(row[key])}
                            />
                          ) : (
                            display(row[key])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <footer className="mt-3 flex items-center justify-end gap-3 text-sm">
            <span>
              {page} · {data.total}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              {t("Previous")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page * 20 >= data.total}
              onClick={() => setPage((n) => n + 1)}
            >
              {t("Next")}
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}
function RecordLinks({
  row,
  reference,
  title,
}: {
  row: Row;
  reference: CollectionReference;
  title: string;
}) {
  const t = useMessages(pagesMessages);
  return (
    <span className="flex items-center justify-between gap-3">
      <a
        className="truncate hover:underline"
        href={collectionHref(reference, row.id)}
      >
        {title}
      </a>
      <a
        className="shrink-0 text-xs text-muted-foreground underline"
        href={`#/pages?${new URLSearchParams({ domain: reference.domain, collection: reference.collection, record: row.id })}`}
      >
        {t("Record page")}
      </a>
    </span>
  );
}
