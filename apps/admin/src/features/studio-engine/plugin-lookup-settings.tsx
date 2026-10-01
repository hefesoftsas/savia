import { useState } from "react";
import type { StudioObject } from "@savia/studio-shared/metadata";
import {
  getPluginLookup,
  isLookupScalar,
  validatePluginLookupTargets,
} from "@savia/studio-shared/plugin-field-lookups";
import { useMessages } from "@/i18n/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "./api";
import { collectionCapabilities } from "./collection-capabilities";
import { withPluginLookup } from "./plugin-lookup-config";
import { pluginLookupMessages as messages } from "./plugin-lookup-settings-messages";

export default function PluginLookupSettings({
  object,
  objects,
  fields,
  onSaved,
  onBack,
}: {
  object: StudioObject;
  objects: StudioObject[];
  fields: string[];
  onSaved: () => void;
  onBack: () => void;
}) {
  const t = useMessages(messages);
  const eligible = fields.filter(
    (key) =>
      object.config.fields[key]?.type === "Textbox" &&
      !object.config.fields[key]?.readOnly &&
      !object.config.fields[key]?.hidden &&
      !object.config.fields[key]?.computedValue &&
      !object.config.fields[key]?.config?.formula,
  );
  const [selected, setSelected] = useState(eligible[0] ?? "");
  return (
    <section
      className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6"
      aria-label={t("Campos conectados")}
    >
      <header className="space-y-2">
        <Button variant="ghost" onClick={onBack}>
          {t("Volver a la pantalla")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("Campos conectados")}</h1>
        <p className="text-muted-foreground">
          {object.label} ·{" "}
          {t("Busca registros de una colección desde los campos del plugin.")}
        </p>
      </header>
      {!eligible.length ? (
        <p role="status">
          {t("Este plugin no declara campos compatibles con búsquedas.")}
        </p>
      ) : (
        <>
          <label className="grid gap-2 font-medium">
            {t("Campo del plugin")}
            <select
              className="h-10 w-full rounded-md border bg-background px-3"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {eligible.map((key) => (
                <option key={key} value={key}>
                  {object.config.fields[key].label}
                </option>
              ))}
            </select>
          </label>
          <LookupForm
            key={`${object.version}:${selected}`}
            object={object}
            objects={objects}
            field={selected}
            onSaved={onSaved}
          />
        </>
      )}
    </section>
  );
}
function LookupForm({
  object,
  objects,
  field,
  onSaved,
}: {
  object: StudioObject;
  objects: StudioObject[];
  field: string;
  onSaved: () => void;
}) {
  const t = useMessages(messages),
    current = getPluginLookup(object.config.fields[field]);
  const [enabled, setEnabled] = useState(!!current),
    [collection, setCollection] = useState(current?.collection ?? ""),
    [label, setLabel] = useState(current?.labelField ?? ""),
    [search, setSearch] = useState<string[]>(current?.searchFields ?? []),
    [filter, setFilter] = useState(current?.filter?.field ?? ""),
    [filterValue, setFilterValue] = useState(
      String(current?.filter?.value ?? ""),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const target = objects.find((o) => o.name === collection);
  const scalar = (o: StudioObject | undefined) =>
    Object.entries(o?.config.fields ?? {}).filter(([, f]) => isLookupScalar(f));
  const targetFields = scalar(target);
  const targets = objects.filter((o) => {
    const c = collectionCapabilities(o);
    return c.read && c.list && c.search !== false && scalar(o).length > 0;
  });
  async function save() {
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const type = target?.config.fields[filter]?.type;
      const value =
        type === "Toggle"
          ? filterValue === "true"
          : ["Number", "Currency", "Percentage", "Rating"].includes(type ?? "")
            ? Number(filterValue)
            : filterValue;
      const next = withPluginLookup(
        object,
        field,
        enabled
          ? {
              collection,
              labelField: label,
              searchFields: search,
              ...(filter ? { filter: { field: filter, value } } : {}),
            }
          : undefined,
      );
      const issues = validatePluginLookupTargets(next, objects);
      if (issues.length) throw new Error(issues.join(" "));
      await api(`/objects/${encodeURIComponent(object.name)}`, "PUT", {
        ...next,
        version: object.version ?? 1,
      });
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selectClass =
    "h-10 w-full rounded-md border bg-background px-3 font-normal";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-6"
    >
      <fieldset disabled={busy} className="space-y-6">
        <label className="grid gap-2 font-medium">
          {t("Entrada del campo")}
          <select
            className={selectClass}
            value={enabled ? "lookup" : "text"}
            onChange={(e) => {
              setEnabled(e.target.value === "lookup");
              setSaved(false);
            }}
          >
            <option value="text">{t("Texto libre")}</option>
            <option value="lookup">{t("Buscar en una colección")}</option>
          </select>
        </label>
        {enabled && (
          <>
            <label className="grid gap-2 font-medium">
              {t("Colección de origen")}
              <select
                required
                className={selectClass}
                value={collection}
                onChange={(e) => {
                  setCollection(e.target.value);
                  setLabel("");
                  setSearch([]);
                  setFilter("");
                  setFilterValue("");
                }}
              >
                <option value="">{t("Selecciona una colección")}</option>
                {targets.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {collection && !target && (
              <p role="alert">
                {t(
                  "La colección configurada ya no está disponible. Selecciona otra o conserva la configuración sin guardar.",
                )}
              </p>
            )}
            <label className="grid gap-2 font-medium">
              {t("Texto que se muestra")}
              <select
                required
                disabled={!target}
                className={selectClass}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              >
                <option value="">{t("Selecciona un campo")}</option>
                {targetFields.map(([key, f]) => (
                  <option key={key} value={key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-3">
              <legend className="mb-2 font-medium">{t("Buscar por")}</legend>
              <p className="text-sm text-muted-foreground">
                {t("Selecciona entre uno y cinco campos.")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {targetFields.map(([key, f]) => (
                  <label key={key} className="flex min-h-10 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={search.includes(key)}
                      disabled={!search.includes(key) && search.length >= 5}
                      onChange={(e) =>
                        setSearch(
                          e.target.checked
                            ? [...search, key]
                            : search.filter((k) => k !== key),
                        )
                      }
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 font-medium">
                {t("Filtro opcional")}
                <select
                  className={selectClass}
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setFilterValue("");
                  }}
                >
                  <option value="">{t("Sin filtro")}</option>
                  {targetFields.map(([key, f]) => (
                    <option key={key} value={key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {filter && (
                <label className="grid gap-2 font-medium">
                  {t("Igual a")}
                  {target?.config.fields[filter]?.type === "Toggle" ? (
                    <select
                      required
                      className={selectClass}
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                    >
                      <option value="">{t("Selecciona un valor")}</option>
                      <option value="true">{t("Sí")}</option>
                      <option value="false">{t("No")}</option>
                    </select>
                  ) : (
                    <Input
                      required
                      type={
                        ["Number", "Currency", "Percentage", "Rating"].includes(
                          target?.config.fields[filter]?.type ?? "",
                        )
                          ? "number"
                          : "text"
                      }
                      step="any"
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                    />
                  )}
                </label>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                "Se guardan el ID seleccionado y una copia del texto. Los registros anteriores no se enlazan automáticamente.",
              )}
            </p>
            {current && current.collection !== collection && (
              <p role="status">
                {t(
                  "Al cambiar de colección, los vínculos anteriores se conservan en su campo original. Debes seleccionar los nuevos vínculos explícitamente.",
                )}
              </p>
            )}
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {saved && <p role="status">{t("Configuración guardada")}</p>}
      <footer className="flex justify-end border-t pt-4">
        <Button
          type="submit"
          disabled={busy || (enabled && (!target || !label || !search.length))}
        >
          {busy ? t("Guardando…") : t("Guardar configuración")}
        </Button>
      </footer>
    </form>
  );
}
