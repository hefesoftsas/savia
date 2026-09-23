import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IFieldProps } from "@form-eng/core";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import { api } from "./api";
import { getStudioRuntime } from "./runtime";

export function CollectionOptionField({
  objectName,
  numeric,
  ...props
}: IFieldProps & { objectName: string; numeric: boolean }) {
  const t = useMessages(recordsMessages);

  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState(1);
  const runtime = getStudioRuntime();
  const result = useQuery({
    queryKey: [
      "collection-options",
      runtime.domainId ?? runtime.apiBasePath,
      objectName,
      props.fieldName,
      props.config?.collectionOptions,
      pages,
    ],
    queryFn: async () => {
      const batches = await Promise.all(
        Array.from({ length: pages }, (_, index) =>
          api<{ data: { value: string; label: string }[]; hasNext: boolean }>(
            `/collection-options/${encodeURIComponent(objectName)}/${encodeURIComponent(props.fieldName!)}?page=${index + 1}`,
          ),
        ),
      );
      return {
        data: batches.flatMap((batch) => batch.data),
        hasNext: batches.at(-1)?.hasNext,
      };
    },
    staleTime: 30000,
  });
  const current = String(props.value ?? "");
  const selected = result.data?.data.find((option) => option.value === current);
  return (
    <div className="grid gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={`${props.config?.inputId ?? props.fieldName}_label`}
            id={String(props.config?.inputId ?? props.fieldName)}
            disabled={props.readOnly}
            variant="outline"
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {selected?.label ??
                (current
                  ? t("Valor actual: %{p0}", { p0: current })
                  : result.isPending
                    ? t("Cargando opciones…")
                    : t("Seleccionar…"))}
            </span>
            <ChevronsUpDown size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput placeholder={t("Buscar entre opciones cargadas…")} />
            <CommandList>
              <CommandEmpty>{t("Sin coincidencias.")}</CommandEmpty>
              <CommandItem
                value="__empty"
                onSelect={() => {
                  props.setFieldValue?.(props.fieldName!, "");
                  setOpen(false);
                }}
              >
                {t("Sin seleccionar")}
              </CommandItem>
              {result.data?.data
                .filter(
                  (option) => !numeric || Number.isFinite(Number(option.value)),
                )
                .map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => {
                      props.setFieldValue?.(
                        props.fieldName!,
                        numeric ? Number(option.value) : option.value,
                      );
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
          {result.data?.hasNext && (
            <Button
              type="button"
              variant="ghost"
              disabled={result.isFetching}
              onClick={() => setPages((p) => p + 1)}
            >
              {t("Cargar más opciones")}
            </Button>
          )}
        </PopoverContent>
      </Popover>
      {result.error && (
        <div role="alert" className="text-sm">
          {t("No se pudieron cargar las opciones.")}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void result.refetch()}
          >
            {t("Reintentar")}
          </button>
        </div>
      )}
    </div>
  );
}
