import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { useMessages } from "@/i18n/core";
import type { RecordBinding } from "./client";
import { collectionHref } from "./collection-block";
import { pagesMessages } from "./messages";

/** Properties always come from the viewer's authorized collection API. */
export function RecordProperties({
  binding,
  api,
}: {
  binding: RecordBinding;
  api: ApiClient;
}) {
  const t = useMessages(pagesMessages);
  const [properties, setProperties] = useState<Array<{
    key: string;
    label: string;
    value: string;
  }> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setProperties(null);
    setError(false);
    if (!/^\/v1\/studio\/\d+$/.test(binding.domain)) {
      setError(true);
      return;
    }
    const base = `${binding.domain}/api`,
      options = { signal: controller.signal };
    void Promise.all([
      api.get<{
        data: Array<{
          name: string;
          config: {
            fieldOrder?: string[];
            fields: Record<string, { label?: string; hidden?: boolean }>;
          };
        }>;
      }>(`${base}/objects`, options),
      api.get<{ data: Record<string, unknown> }>(
        `${base}/records/${encodeURIComponent(binding.collection)}/${encodeURIComponent(binding.recordId)}`,
        options,
      ),
    ])
      .then(([objects, record]) => {
        const schema = objects.data.find(
          (item) => item.name === binding.collection,
        )?.config;
        if (!schema) throw new Error("Collection unavailable");
        const result = (schema.fieldOrder ?? Object.keys(schema.fields))
          .filter(
            (key) =>
              schema.fields[key] &&
              !schema.fields[key].hidden &&
              Object.hasOwn(record.data, key),
          )
          .map((key) => ({
            key,
            label: schema.fields[key].label ?? key,
            value:
              typeof record.data[key] === "object" && record.data[key] !== null
                ? "—"
                : String(record.data[key] ?? "—"),
          }));
        if (!controller.signal.aborted) setProperties(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [api, binding.domain, binding.collection, binding.recordId]);
  return (
    <section className="mb-6 border-y py-4" aria-label={t("Properties")}>
      <a
        className="text-sm underline"
        href={collectionHref(binding, binding.recordId)}
      >
        {t("Record page")} · {binding.collection} ↗
      </a>
      {error ? (
        <p className="mt-3 text-sm" role="alert">
          {t("Unavailable")}
        </p>
      ) : properties === null ? (
        <p role="status">{t("Loading")}</p>
      ) : (
        <dl className="mt-3 grid grid-cols-[minmax(100px,1fr)_2fr] gap-x-4 gap-y-2 text-sm">
          {properties.map((property) => (
            <div className="contents" key={property.key}>
              <dt className="text-muted-foreground">{property.label}</dt>
              <dd className="break-words">{property.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
