import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  PluginApi,
  PluginCollectionListOptions,
} from "@savia/studio-shared/plugin-api";
import type { PluginLookup } from "@savia/studio-shared/plugin-field-lookups";
import type { WorkbenchTranslator } from "./localization";
import type { WorkRecord } from "./data";

type LookupListOptions = PluginCollectionListOptions & {
  searchFields: string[];
};

type Props = {
  savia: PluginApi;
  mapping: PluginLookup;
  fieldKey: string;
  label: string;
  snapshot: string;
  referenceId: string;
  disabled?: boolean;
  t: WorkbenchTranslator;
  onSelect: (id: string, label: string) => void;
  onClear: () => void;
};

/** Search-only control: a draft query never mutates the saved label or reference. */
export function RecordLookup({
  savia,
  mapping,
  fieldKey,
  label,
  snapshot,
  referenceId,
  disabled = false,
  t,
  onSelect,
  onClear,
}: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [options, setOptions] = useState<WorkRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!open) return;
    const consumePickerEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !(event.target instanceof Node) ||
        !rootRef.current?.contains(event.target)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      setActive(-1);
    };
    // Window capture runs before the drawer's document capture handler, so one
    // Escape closes the suggestion list without closing the surrounding panel.
    window.addEventListener("keydown", consumePickerEscape, true);
    return () =>
      window.removeEventListener("keydown", consumePickerEscape, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const requestId = ++sequence.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      const collection = (
        savia.localRecords ?? savia.collections
      ).collection<WorkRecord>(mapping.collection);
      void (async () => {
        try {
          const definition = await collection.describe();
          if (!definition) throw new Error("missing");
          if (sequence.current !== requestId) return;
          const fields = definition.config?.fields ?? {};
          if (
            !fields[mapping.labelField] ||
            mapping.searchFields.some((field) => !fields[field]) ||
            (mapping.filter && !fields[mapping.filter.field])
          )
            throw new Error("stale mapping");
          const result = await (
            collection.list as (
              options: LookupListOptions,
            ) => Promise<{ data: WorkRecord[]; total: number }>
          )({
            q: query.trim() || undefined,
            searchFields: [...mapping.searchFields],
            page,
            perPage: 20,
            sort: mapping.labelField,
            order: "ASC",
            filters: mapping.filter
              ? {
                  conditions: [
                    {
                      field: mapping.filter.field,
                      op: "eq",
                      value: mapping.filter.value,
                    },
                  ],
                }
              : undefined,
          });
          if (sequence.current !== requestId) return;
          setOptions(result.data);
          setTotal(result.total);
          setActive(-1);
        } catch {
          if (sequence.current !== requestId) return;
          setOptions([]);
          setTotal(0);
          setError(true);
        } finally {
          if (sequence.current === requestId) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      sequence.current += 1;
    };
  }, [savia, mapping, open, query, page, retry]);

  function choose(record: WorkRecord) {
    const id = record.id == null ? "" : String(record.id);
    const value = record[mapping.labelField];
    if (!id || !["string", "number", "boolean"].includes(typeof value)) return;
    onSelect(id, String(value));
    setQuery("");
    setOpen(false);
    setPage(1);
    setActive(-1);
  }

  function keyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        Math.min(current + 1, Math.max(options.length - 1, 0)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && options[active]) choose(options[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  }

  const hasSnapshot = snapshot.length > 0 || referenceId.length > 0;
  const nextPage = page * 20 < total;
  return (
    <div ref={rootRef} className="iw-record-lookup" data-iw-lookup-picker>
      <input
        id={`iw-field-${fieldKey}`}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={
          active >= 0 && options[active]
            ? `${listboxId}-option-${active}`
            : undefined
        }
        autoComplete="off"
        disabled={disabled}
        placeholder={t("Buscar por %{field}", { field: label.toLowerCase() })}
        value={query}
        onFocus={() => {
          if (!open) {
            setOptions([]);
            setActive(-1);
            setLoading(true);
            setError(false);
          }
          setOpen(true);
        }}
        onChange={(event) => {
          setOptions([]);
          setActive(-1);
          setLoading(true);
          setError(false);
          setQuery(event.target.value);
          setPage(1);
          setOpen(true);
        }}
        onKeyDown={keyDown}
        onBlur={(event) => {
          if (
            !event.currentTarget.parentElement?.contains(
              event.relatedTarget as Node | null,
            )
          )
            setOpen(false);
        }}
      />
      {hasSnapshot && (
        <div className="iw-record-lookup-current" aria-live="polite">
          <span>{t("Referencia guardada")}: </span>
          <strong>{snapshot || t("ID sin etiqueta")}</strong>
          {hasSnapshot && (
            <button type="button" disabled={disabled} onClick={onClear}>
              {t("Quitar referencia")}
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="iw-record-lookup-results">
          {loading ? <p role="status">{t("Buscando referencias…")}</p> : null}
          {error && (
            <div role="alert" className="iw-record-lookup-error">
              <span>
                {t(
                  "No se pudieron cargar las opciones. Revisa el acceso y vuelve a intentarlo.",
                )}
              </span>
              <button
                type="button"
                disabled={disabled || loading}
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("Reintentar")}
              </button>
            </div>
          )}
          {!loading && !error && options.length === 0 && (
            <p role="status">{t("No hay referencias que coincidan.")}</p>
          )}
          {options.length > 0 && (
            <>
              <ul
                id={listboxId}
                role="listbox"
                aria-label={t("Opciones de %{field}", { field: label })}
              >
                {options.map((record, index) => {
                  const value = record[mapping.labelField];
                  const optionLabel = value == null ? "" : String(value);
                  return (
                    <li key={record.id}>
                      <button
                        id={`${listboxId}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={active === index}
                        disabled={disabled}
                        onMouseEnter={() => setActive(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(record)}
                      >
                        <span>{optionLabel || t("Sin etiqueta")}</span>
                        {String(record.id) === referenceId && (
                          <small>{t("Referencia actual")}</small>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div
                className="iw-record-lookup-pagination"
                aria-label={t("Paginación de referencias")}
              >
                <button
                  type="button"
                  disabled={disabled || page <= 1 || loading}
                  onClick={() => {
                    setOptions([]);
                    setActive(-1);
                    setLoading(true);
                    setPage((value) => value - 1);
                  }}
                >
                  {t("Página anterior")}
                </button>
                <span>{t("Página %{page}", { page })}</span>
                <button
                  type="button"
                  disabled={disabled || !nextPage || loading}
                  onClick={() => {
                    setOptions([]);
                    setActive(-1);
                    setLoading(true);
                    setPage((value) => value + 1);
                  }}
                >
                  {t("Página siguiente")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
