import { useAppLocale, useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IFieldProps } from "@form-eng/core";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { resolveAddressAutocomplete } from "@savia/studio-shared/address-autocomplete";

function LongText(p: IFieldProps) {
  return (
    <Textarea
      minLength={p.config?.minLength as number | undefined}
      maxLength={p.config?.maxLength as number | undefined}
      id={String(p.config?.inputId ?? p.fieldName)}
      aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
      aria-invalid={!!p.error}
      aria-required={p.required}
      disabled={p.readOnly}
      value={String(p.value ?? "")}
      onChange={(e) => p.setFieldValue?.(p.fieldName!, e.target.value)}
    />
  );
}

export function AddressField(p: IFieldProps) {
  const settings = resolveAddressAutocomplete(p.config);
  if (!settings) return <LongText {...p} />;
  return <AddressAutocompleteField {...p} settings={settings} />;
}

function AddressAutocompleteField({
  settings,
  ...p
}: IFieldProps & {
  settings: NonNullable<ReturnType<typeof resolveAddressAutocomplete>>;
}) {
  const t = useMessages(recordsMessages);
  const locale = useAppLocale();

  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(String(p.value ?? ""));
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    setQuery(String(p.value ?? ""));
  }, [p.value]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: [
      "geocoding",
      debouncedQuery,
      settings.provider,
      settings.country,
      settings.language ?? locale,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        q: debouncedQuery.trim(),
        provider: settings.provider,
        language: settings.language ?? locale,
      });
      if (settings.country) params.set("country", settings.country);
      return api<{ data: { label: string; value: string }[] }>(
        `/geocoding/search?${params}`,
      ).then((response) => response.data);
    },
    enabled: open && debouncedQuery.trim().length >= 3 && !p.readOnly,
    staleTime: 60_000,
  });

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const suggestions = results.data ?? [];
  const showSuggestions = open && suggestions.length > 0;

  return (
    <div ref={rootRef} className="relative">
      <Input
        id={String(p.config?.inputId ?? p.fieldName)}
        aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
        aria-invalid={!!p.error}
        aria-required={p.required}
        aria-autocomplete="list"
        aria-expanded={showSuggestions}
        aria-controls={showSuggestions ? listId : undefined}
        role="combobox"
        disabled={p.readOnly}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          p.setFieldValue?.(p.fieldName!, next);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {results.isFetching ? (
        <p className="studio-field-help">{t("Buscando direcciones…")}</p>
      ) : null}
      {results.isError ? (
        <p className="studio-field-help" role="status">
          {t("No se pudieron cargar sugerencias de dirección.")}
        </p>
      ) : null}
      {showSuggestions ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.value} role="presentation">
              <button
                type="button"
                role="option"
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                  query === suggestion.value && "bg-accent",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery(suggestion.value);
                  p.setFieldValue?.(p.fieldName!, suggestion.value);
                  setOpen(false);
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="studio-field-help">
        {t("Escribe al menos 3 caracteres para buscar direcciones.")}
      </p>
    </div>
  );
}
