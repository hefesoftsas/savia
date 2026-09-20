import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IFieldProps } from "@form-eng/core";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import { relationRecordLabel } from "./relation-record-label";

export function CollectionRelationPicker(props: IFieldProps) {
  const t = useMessages(recordsMessages);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [knownLabels, setKnownLabels] = useState<Record<string, string>>({});
  const runtime = getCrmRuntime();
  const target = String(props.config?.collectionRelationTarget ?? "");
  const displayField = props.config?.relationDisplayField
    ? String(props.config.relationDisplayField)
    : undefined;
  const multiple = !!props.config?.multiple;
  const selected = (
    multiple
      ? Array.isArray(props.value)
        ? props.value
        : []
      : props.value
        ? [props.value]
        : []
  ).map(String);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const options = useQuery({
    queryKey: [
      "relation-options",
      runtime.apiBasePath,
      runtime.domainId,
      target,
      search,
      page,
    ],
    enabled: open && !!target,
    queryFn: () =>
      api<{ data: Record<string, unknown>[]; total?: number }>(
        `/records/${encodeURIComponent(target)}?${new URLSearchParams({ q: search, page: String(page), perPage: "20" })}`,
      ),
  });
  const labels = useQuery({
    queryKey: [
      "relation-selected",
      runtime.apiBasePath,
      runtime.domainId,
      target,
      displayField,
      selected,
    ],
    enabled: !!target && selected.length > 0,
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          selected.map(async (id) => {
            try {
              const result = await api<{ data: Record<string, unknown> }>(
                `/records/${encodeURIComponent(target)}/${encodeURIComponent(id)}`,
              );
              return [
                id,
                relationRecordLabel({ ...result.data, id }, displayField),
              ];
            } catch {
              return [id, id];
            }
          }),
        ),
      ),
  });
  const labelFor = (id: string) => knownLabels[id] ?? labels.data?.[id] ?? id;
  function choose(id: string, label: string) {
    setKnownLabels((current) => ({ ...current, [id]: label }));
    props.setFieldValue?.(
      props.fieldName!,
      multiple
        ? selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id]
        : id,
    );
    if (!multiple) setOpen(false);
  }
  return (
    <div className="relative space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            id={props.fieldName}
            aria-labelledby={`${props.fieldName}_label`}
            aria-expanded={open}
            aria-controls={`${props.fieldName}-options`}
            disabled={props.readOnly}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {selected.length
                ? multiple
                  ? t("%{p0} seleccionados", { p0: selected.length })
                  : labelFor(selected[0])
                : multiple
                  ? t("Seleccionar registros…")
                  : t("Seleccionar registro…")}
            </span>
            <ChevronsUpDown className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] space-y-2 p-2"
        >
          <Input
            aria-label={t("Buscar registros relacionados")}
            placeholder={t("Buscar…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {options.isPending && (
            <p role="status" className="p-2 text-sm">
              {t("Buscando registros…")}
            </p>
          )}
          {options.error && (
            <p role="alert">
              {options.error.message}{" "}
              <Button
                type="button"
                variant="ghost"
                onClick={() => options.refetch()}
              >
                {t("Reintentar")}
              </Button>
            </p>
          )}
          <div
            id={`${props.fieldName}-options`}
            role="listbox"
            aria-label={t("Registros disponibles")}
            aria-multiselectable={multiple}
            className="max-h-56 overflow-y-auto"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="option"]',
                ),
              );
              const index = items.indexOf(event.target as HTMLButtonElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              event.preventDefault();
              items[next]?.focus();
            }}
          >
            {options.data?.data.map((record) => {
              const id = String(record.id);
              const label = relationRecordLabel(record, displayField);
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={selected.includes(id)}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent"
                  onClick={() => choose(id, label)}
                >
                  {label}
                  {selected.includes(id) && (
                    <Check className="size-4 shrink-0" />
                  )}
                </button>
              );
            })}
            {options.data && !options.data.data.length && (
              <p className="p-2 text-sm text-muted-foreground">
                {t("No hay coincidencias.")}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={page === 1 || options.isFetching}
              onClick={() => setPage(page - 1)}
            >
              {t("Anterior")}
            </Button>
            <span className="text-xs">
              {t("Página")} {page}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={
                options.isFetching ||
                (options.data?.total != null
                  ? page * 20 >= options.data.total
                  : (options.data?.data.length ?? 0) < 20)
              }
              onClick={() => setPage(page + 1)}
            >
              {t("Siguiente")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {!multiple && selected.length > 0 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute end-8 top-0 h-9 w-7"
          disabled={props.readOnly}
          aria-label={t("Quitar %{p0}", { p0: labelFor(selected[0]) })}
          onClick={() => props.setFieldValue?.(props.fieldName!, "")}
        >
          <X className="size-3" />
        </Button>
      )}
      {multiple && selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id) => (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              key={id}
              disabled={props.readOnly}
              aria-label={t("Quitar %{p0}", { p0: labelFor(id) })}
              onClick={() =>
                props.setFieldValue?.(
                  props.fieldName!,
                  multiple ? selected.filter((value) => value !== id) : "",
                )
              }
            >
              {labelFor(id)}
              <X className="size-3" />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
