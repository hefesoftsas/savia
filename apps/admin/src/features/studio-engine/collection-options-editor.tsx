import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { getStudioRuntime } from "./runtime";
import type { StudioObject } from "@savia/studio-shared/metadata";
import {
  collectionOptionsSchema,
  type CollectionOptionsSource,
} from "@savia/studio-shared/collection-options";

export function CollectionOptionsEditor({
  object,
  fields,
  onChange,
}: {
  object: StudioObject;
  fields: StudioObject["config"]["fields"];
  onChange: (fields: StudioObject["config"]["fields"]) => void;
}) {
  const t = useMessages(studioMessages);
  const runtime = getStudioRuntime();
  const catalog = useQuery({
    queryKey: [
      "option-collection-catalog",
      runtime.domainId ?? runtime.apiBasePath,
    ],
    queryFn: () =>
      api<{ data: { domain: string; collection: string; title: string }[] }>(
        "/collection-catalog",
      ),
  });
  function change(key: string, source?: CollectionOptionsSource) {
    const config = { ...fields[key].config };
    if (source) config.collectionOptions = source;
    else delete config.collectionOptions;
    onChange({ ...fields, [key]: { ...fields[key], config } });
  }
  return (
    <section
      className="grid gap-4"
      aria-label={t("Selectores desde colecciones")}
    >
      <div>
        <h3>{t("Selectores desde colecciones")}</h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "Elige la colección y los campos del documento que proporcionan el valor y su etiqueta.",
          )}
        </p>
      </div>
      {catalog.error && (
        <p role="alert">
          {t("No se pudo cargar el catálogo.")}{" "}
          <button type="button" onClick={() => void catalog.refetch()}>
            {t("Reintentar")}
          </button>
        </p>
      )}
      {Object.entries(fields)
        .filter(
          ([, field]) =>
            !field.readOnly &&
            ["Textbox", "Number", "Dropdown", "Autocomplete"].includes(
              field.type,
            ) &&
            !field.config?.relation,
        )
        .map(([key, field]) => {
          const parsed = collectionOptionsSchema.safeParse(
            field.config?.collectionOptions,
          );
          const source = parsed.success ? parsed.data : undefined;
          return (
            <div key={key} className="grid gap-2 rounded-md border p-3">
              <label
                htmlFor={`option-source-${key}`}
                className="text-sm font-medium"
              >
                {field.label}
              </label>
              <select
                disabled={catalog.isPending || !!catalog.error}
                id={`option-source-${key}`}
                className="w-full rounded-md border p-2 text-sm"
                value={source ? `${source.domain}/${source.collection}` : ""}
                onChange={(event) => {
                  const entry = catalog.data?.data.find(
                    (entry) =>
                      `${entry.domain}/${entry.collection}` ===
                      event.target.value,
                  );
                  change(
                    key,
                    entry
                      ? {
                          domain: entry.domain,
                          collection: entry.collection,
                          valueField:
                            entry.domain === "reference-values"
                              ? "attributes.code"
                              : "id",
                          labelField:
                            entry.domain === "agency-network"
                              ? "attributes.organization.displayName"
                              : "attributes.label",
                        }
                      : undefined,
                  );
                }}
              >
                <option value="">
                  {catalog.isPending
                    ? t("Cargando colecciones…")
                    : t("Sin colección · control original")}
                </option>
                {source &&
                  !catalog.data?.data.some(
                    (entry) =>
                      entry.domain === source.domain &&
                      entry.collection === source.collection,
                  ) && (
                    <option value={`${source.domain}/${source.collection}`}>
                      {source.collection}
                    </option>
                  )}
                {catalog.data?.data.map((entry) => (
                  <option
                    key={`${entry.domain}/${entry.collection}`}
                    value={`${entry.domain}/${entry.collection}`}
                  >
                    {entry.title} · {entry.domain}
                  </option>
                ))}
              </select>
              {source && (
                <div className="grid gap-2">
                  <label className="text-sm">
                    {t("Valor guardado")}
                    <input
                      className="mt-1 w-full rounded-md border p-2"
                      aria-label={t("Valor guardado · %{v1}", {
                        v1: field.label,
                      })}
                      value={source.valueField}
                      onChange={(event) =>
                        change(key, {
                          ...source,
                          valueField: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="text-sm">
                    {t("Etiqueta visible")}
                    <input
                      className="mt-1 w-full rounded-md border p-2"
                      aria-label={t("Etiqueta visible · %{v1}", {
                        v1: field.label,
                      })}
                      value={source.labelField}
                      onChange={(event) =>
                        change(key, {
                          ...source,
                          labelField: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
    </section>
  );
}
