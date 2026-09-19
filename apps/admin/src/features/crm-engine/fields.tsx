import { MultiSelectField } from "./multi-select-field";
import { RichTextField } from "./rich-text-field";
import { DateTimeField } from "./date-time-field";
import { TimeField } from "./time-field";
import { CollectionRelationPicker } from "./collection-relation-picker";
import { useDependentOptions } from "./dependent-options";
import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "./api";
import { getCrmRuntime } from "./runtime";
import { relationRecordLabel } from "./relation-record-label";
import { prepareRecord } from "@savia/crm-shared/rules";
import {
  r2AttachmentPolicy,
  type CrmObject,
} from "@savia/crm-shared/metadata";
import type { IFieldProps } from "@form-eng/core";
import { createRadixFieldRegistry } from "@form-eng/radix";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { R2AttachmentField } from "./r2-attachment-field";
import { AddressField } from "./address-field";
import { DisplayTextField } from "./display-text-field";
import { FormHtmlField } from "./form-html-field";
import { MapLocationField } from "./map-location-field";
import { useAttachmentQueue } from "./attachment-queue";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
function textInputType(format: unknown) {
  return format === "email"
    ? "email"
    : format === "url"
      ? "url"
      : format === "phone"
        ? "tel"
        : "text";
}
function TextField(p: IFieldProps) {
  return (
    <Input
      id={String(p.config?.inputId ?? p.fieldName)}
      aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
      aria-invalid={!!p.error}
      aria-required={p.required}
      disabled={p.readOnly}
      type={textInputType(p.config?.format)}
      minLength={p.config?.minLength as number | undefined}
      maxLength={p.config?.maxLength as number | undefined}
      pattern={p.config?.pattern as string | undefined}
      value={String(p.value ?? "")}
      onInput={(e) => p.setFieldValue?.(p.fieldName!, e.currentTarget.value)}
      onChange={(e) => p.setFieldValue?.(p.fieldName!, e.target.value)}
    />
  );
}
function NumberField(p: IFieldProps) {
  const values = useWatch();
  const { setValue } = useFormContext();
  const object = p.config?.studioObject as CrmObject | undefined;
  let computed = p.value;
  let calculationError = "";
  try {
    if (p.config?.formula && object)
      computed = prepareRecord(object, values)[p.fieldName!];
  } catch (e) {
    calculationError = (e as Error).message;
  }
  useEffect(() => {
    if (p.config?.formula && !calculationError && !Object.is(p.value, computed))
      setValue(p.fieldName!, computed);
  }, [
    computed,
    p.value,
    p.fieldName,
    p.config?.formula,
    calculationError,
    setValue,
  ]);
  return (
    <>
      <span className="sr-only" role="status">
        {calculationError}
      </span>
      <Input
        id={String(p.config?.inputId ?? p.fieldName)}
        aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
        aria-invalid={!!p.error}
        aria-required={p.required}
        disabled={p.readOnly}
        type="number"
        step={p.config?.integer ? "1" : "any"}
        min={p.config?.minimum as number | undefined}
        max={p.config?.maximum as number | undefined}
        value={computed == null ? "" : String(computed)}
        onChange={(e) =>
          p.setFieldValue?.(
            p.fieldName!,
            e.target.value === "" ? null : Number(e.target.value),
          )
        }
      />
      {p.config?.formula ? (
        <small className="studio-field-help">
          {calculationError || "Calculado automáticamente"}
        </small>
      ) : null}
    </>
  );
}
function parseCurrencyString(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const isNegative = trimmed.startsWith("-");
  const clean = trimmed.replace(/^[+-]/, "");

  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");

  let integerPart = clean;
  let decimalPart = "";

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      integerPart = clean.slice(0, lastComma).replace(/\./g, "");
      decimalPart = clean.slice(lastComma + 1);
    } else {
      integerPart = clean.slice(0, lastDot).replace(/,/g, "");
      decimalPart = clean.slice(lastDot + 1);
    }
  } else if (lastComma !== -1) {
    const commaCount = (clean.match(/,/g) || []).length;
    if (commaCount === 1) {
      integerPart = clean.slice(0, lastComma);
      decimalPart = clean.slice(lastComma + 1);
    } else {
      integerPart = clean.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const dotCount = (clean.match(/\./g) || []).length;
    if (dotCount === 1) {
      integerPart = clean.slice(0, lastDot);
      decimalPart = clean.slice(lastDot + 1);
    } else {
      integerPart = clean.replace(/\./g, "");
    }
  }

  const cleanInt = integerPart.replace(/\D/g, "");
  const cleanDec = decimalPart.replace(/\D/g, "");

  if (!cleanInt && !cleanDec) return null;

  const numStr = `${isNegative ? "-" : ""}${cleanInt || "0"}${cleanDec ? `.${cleanDec}` : ""}`;
  const val = Number(numStr);
  return Number.isFinite(val) ? val : null;
}

function CurrencyField(p: IFieldProps) {
  const values = useWatch();
  const { setValue } = useFormContext();
  const object = p.config?.studioObject as CrmObject | undefined;
  let computed = p.value;
  let calculationError = "";
  try {
    if (p.config?.formula && object)
      computed = prepareRecord(object, values)[p.fieldName!];
  } catch (e) {
    calculationError = (e as Error).message;
  }
  useEffect(() => {
    if (p.config?.formula && !calculationError && !Object.is(p.value, computed))
      setValue(p.fieldName!, computed);
  }, [
    computed,
    p.value,
    p.fieldName,
    p.config?.formula,
    calculationError,
    setValue,
  ]);
  const currencyCode = String(p.config?.currency || "COP");
  const decimals =
    typeof p.config?.decimals === "number"
      ? p.config.decimals
      : p.config?.integer
        ? 0
        : 2;

  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [localText, setLocalText] = useState<string>("");

  useEffect(() => {
    if (!isFocused) {
      if (computed == null || computed === "") {
        setLocalText("");
      } else {
        const num = Number(computed);
        if (Number.isFinite(num)) {
          setLocalText(
            new Intl.NumberFormat("es-CO", {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            }).format(num),
          );
        } else {
          setLocalText(String(computed));
        }
      }
    }
  }, [computed, isFocused, decimals]);

  const handleFocus = () => {
    setIsFocused(true);
    if (computed != null && computed !== "") {
      const num = Number(computed);
      if (Number.isFinite(num)) {
        setLocalText(decimals > 0 ? num.toFixed(decimals) : String(num));
      } else {
        setLocalText(String(computed));
      }
    } else {
      setLocalText("");
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseCurrencyString(localText);
    if (parsed !== null) {
      const finalVal = p.config?.integer ? Math.round(parsed) : parsed;
      p.setFieldValue?.(p.fieldName!, finalVal);
      setLocalText(
        new Intl.NumberFormat("es-CO", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(finalVal),
      );
    } else {
      p.setFieldValue?.(p.fieldName!, null);
      setLocalText("");
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setLocalText(text);
    const parsed = parseCurrencyString(text);
    if (parsed !== null) {
      const finalVal = p.config?.integer ? Math.round(parsed) : parsed;
      p.setFieldValue?.(p.fieldName!, finalVal);
    } else if (text.trim() === "") {
      p.setFieldValue?.(p.fieldName!, null);
    }
  };

  return (
    <>
      <span className="sr-only" role="status">
        {calculationError}
      </span>
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "border-input dark:bg-input/30 flex h-9 w-full min-w-0 items-center rounded-md border bg-transparent px-3 text-base shadow-xs transition-[color,box-shadow] md:text-sm cursor-text",
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          p.error && "border-destructive ring-destructive/20 dark:ring-destructive/40 ring-[3px]",
          p.readOnly && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          className="flex shrink-0 select-none items-center pr-1.5 text-sm font-semibold text-muted-foreground"
          aria-hidden="true"
        >
          $
        </span>
        <input
          ref={inputRef}
          id={String(p.config?.inputId ?? p.fieldName)}
          aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
          aria-invalid={!!p.error}
          aria-required={p.required}
          disabled={p.readOnly}
          type="text"
          inputMode="decimal"
          className="h-full w-full min-w-0 flex-1 bg-transparent py-1 font-mono text-sm tracking-tight outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground disabled:pointer-events-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          placeholder={new Intl.NumberFormat("es-CO", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }).format(0)}
          value={localText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={handleChange}
        />
        <span
          className="ml-2 inline-flex shrink-0 select-none items-center rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 text-[11px] font-semibold tracking-wider text-muted-foreground shadow-2xs"
          aria-hidden="true"
        >
          {currencyCode}
        </span>
      </div>
      {p.config?.formula ? (
        <small className="studio-field-help">
          {calculationError || "Calculado automáticamente"}
        </small>
      ) : null}
    </>
  );
}
function DateField(p: IFieldProps) {
  return (
    <Input
      id={String(p.config?.inputId ?? p.fieldName)}
      aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
      aria-invalid={!!p.error}
      aria-required={p.required}
      disabled={p.readOnly}
      type="date"
      onInput={(e) => p.setFieldValue?.(p.fieldName!, e.currentTarget.value)}
      value={String(p.value ?? "").slice(0, 10)}
      onChange={(e) => p.setFieldValue?.(p.fieldName!, e.target.value)}
    />
  );
}
function formattedTextField(format: "email" | "phone" | "url") {
  return function FormattedTextField(p: IFieldProps) {
    return <TextField {...p} config={{ ...p.config, format }} />;
  };
}
const EmailField = formattedTextField("email");
const PhoneField = formattedTextField("phone");
const UrlField = formattedTextField("url");
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
function SelectField(p: IFieldProps) {
  const { options, dependency, waiting } = useDependentOptions(p);
  if (p.config?.relation) return <RelationField {...p} />;
  return (
    <>
      <Select
        disabled={p.readOnly || waiting}
        value={String(p.value ?? "") || "__empty"}
        onValueChange={(value) =>
          p.setFieldValue?.(p.fieldName!, value === "__empty" ? "" : value)
        }
      >
        <SelectTrigger
          id={String(p.config?.inputId ?? p.fieldName)}
          aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
          aria-invalid={!!p.error}
          aria-required={p.required}
        >
          <SelectValue placeholder="Seleccionar…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty">Seleccionar…</SelectItem>
          {options
            .filter((o) => o.value !== "")
            .map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {dependency && (
        <p className="studio-field-help">
          {waiting
            ? "Selecciona primero el campo del que depende."
            : options.length
              ? "Opciones según la selección anterior."
              : "No hay opciones para la selección anterior."}
        </p>
      )}
    </>
  );
}
function AutocompleteField(p: IFieldProps) {
  const { options, dependency, waiting } = useDependentOptions(p);
  const [open, setOpen] = useState(false);
  const currentValue = String(p.value ?? "");
  const selected = options.find((option) => option.value === currentValue);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            id={String(p.config?.inputId ?? p.fieldName)}
            aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
            aria-invalid={!!p.error}
            aria-required={p.required}
            disabled={p.readOnly || waiting}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {selected?.label ?? "Seleccionar…"}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Buscar opción…" />
            <CommandList>
              <CommandEmpty>Sin coincidencias.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__empty"
                  onSelect={() => {
                    p.setFieldValue?.(p.fieldName!, "");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      !currentValue ? "opacity-100" : "opacity-0",
                    )}
                  />
                  Seleccionar…
                </CommandItem>
                {options
                  .filter((option) => option.value !== "")
                  .map((option) => (
                    <CommandItem
                      key={String(option.value)}
                      value={`${option.label} ${option.value}`}
                      onSelect={() => {
                        p.setFieldValue?.(p.fieldName!, option.value);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-4",
                          currentValue === option.value
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      {option.label}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {dependency && (
        <p className="studio-field-help">
          {waiting
            ? "Selecciona primero el campo del que depende."
            : options.length
              ? "Opciones según la selección anterior."
              : "No hay opciones para la selección anterior."}
        </p>
      )}
    </>
  );
}
export function RelationField(p: IFieldProps) {
  const relation = String(p.config?.relation ?? "");
  const runtime = getCrmRuntime();
  const displayField = p.config?.relationDisplayField ? String(p.config.relationDisplayField) : undefined;
  const multiple = !!p.config?.multiple;
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const selected = (
    multiple
      ? Array.isArray(p.value)
        ? p.value
        : []
      : p.value
        ? [p.value]
        : []
  ).map(String);
  const results = useQuery({
    queryKey: ["relation-options", runtime.apiBasePath, runtime.domainId, relation, search, page],
    queryFn: () =>
      api(
        `/records/${encodeURIComponent(relation)}?${new URLSearchParams({ q: search, page: String(page), perPage: "20" })}`,
      ),
  });
  const labels = useQuery({
    queryKey: ["relation-selected", runtime.apiBasePath, runtime.domainId, relation, displayField, selected],
    enabled: selected.length > 0,
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          selected.map(async (id) => {
            try {
              const result = await api(
                `/records/${encodeURIComponent(relation)}/${encodeURIComponent(id)}`,
              );
              return [id, relationRecordLabel({...result.data, id}, displayField)];
            } catch {
              return [id, id];
            }
          }),
        ),
      ),
  });
  const toggle = (id: string) =>
    p.setFieldValue?.(
      p.fieldName!,
      multiple
        ? selected.includes(id)
          ? selected.filter((v) => v !== id)
          : [...selected, id]
        : id === selected[0]
          ? ""
          : id,
    );
  return (
    <div className="studio-relation">
      {!!selected.length && (
        <div className="studio-relation-selected">
          {selected.map((id) => (
            <Button
              type="button"
              variant="outline"
              size="sm"
              key={id}
              disabled={p.readOnly}
              onClick={() => toggle(id)}
              aria-label={`Quitar ${labels.data?.[id] ?? id}`}
            >
              {labels.data?.[id] ?? id} ×
            </Button>
          ))}
        </div>
      )}
      {!p.readOnly && (
        <>
          <Input
            id={String(p.config?.inputId ?? p.fieldName)}
            aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
            placeholder="Buscar registros…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.isPending && <p role="status">Buscando registros…</p>}
          {results.error && (
            <p role="alert">
              {results.error.message}{" "}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => results.refetch()}
              >
                Reintentar
              </Button>
            </p>
          )}
          <div
            className="studio-relation-options"
            role="group"
            aria-label="Registros disponibles"
          >
            {results.data?.data.map((record: any) => (
              <button
                type="button"
                key={record.id}
                aria-pressed={selected.includes(String(record.id))}
                onClick={() => toggle(String(record.id))}
              >
                {relationRecordLabel(record, displayField)}
                {selected.includes(String(record.id)) ? " ✓" : ""}
              </button>
            ))}
          </div>
          {results.data && !results.data.data.length && (
            <p>No hay registros coincidentes.</p>
          )}
          <div className="studio-pager">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={page === 1 || results.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <span>Página {page}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={
                results.isFetching ||
                (results.data?.total != null
                  ? page * 20 >= results.data.total
                  : (results.data?.data.length ?? 0) < 20)
              }
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}
      {p.readOnly && !selected.length && <span>Sin relación</span>}
    </div>
  );
}
function BooleanField(p: IFieldProps) {
  return (
    <Switch
      id={String(p.config?.inputId ?? p.fieldName)}
      aria-labelledby={`${p.config?.inputId ?? p.fieldName}_label`}
      aria-invalid={!!p.error}
      disabled={p.readOnly}
      checked={p.value === true}
      onCheckedChange={(value) => p.setFieldValue?.(p.fieldName!, value)}
    />
  );
}
function R2FileField(p: IFieldProps) {
  const object = p.config?.studioObject as CrmObject | undefined;
  const fallback = Array.isArray(p.value)
    ? p.value.filter((value): value is File => value instanceof File)
    : [];
  const queue = useAttachmentQueue(p.fieldName ?? "", fallback);
  const recordId = String(p.config?.recordId ?? "") || undefined;
  if (!object || !p.fieldName) return null;
  return (
    <R2AttachmentField
      disabled={p.readOnly || Boolean(queue.uploadingFile)}
      field={p.fieldName}
      inputId={p.fieldName}
      object={object.name}
      onPendingChange={queue.setFiles}
      pending={queue.files}
      policy={r2AttachmentPolicy(p.config as Record<string, unknown>)}
      recordId={recordId}
      refreshVersion={queue.version}
      uploadedFiles={queue.uploadedFiles}
      uploadingFile={queue.uploadingFile}
    />
  );
}
// Keep the Radix adapter registry extensible, with shadcn controls for supported CRM types.
export const registry = {
  ...createRadixFieldRegistry(),
  Textbox: <TextField />,
  Email: <EmailField />,
  Phone: <PhoneField />,
  Url: <UrlField />,
  Address: <AddressField />,
  MapLocation: <MapLocationField />,
  FormHtml: <FormHtmlField />,
  DisplayText: <DisplayTextField />,
  Number: <NumberField />,
  Currency: <CurrencyField />,
  DateControl: <DateField />,
  DateTime: <DateTimeField />,
  Time: <TimeField />,
  Textarea: <LongText />,
  RichText: <RichTextField />,
  MultiSelect: <MultiSelectField />,
  Dropdown: <SelectField />,
  Autocomplete: <AutocompleteField />,
  CrmRelation: <RelationField />,
  CrmCollectionRelation: <CollectionRelationPicker />,
  Toggle: <BooleanField />,
  R2Attachment: <R2FileField />,
};
