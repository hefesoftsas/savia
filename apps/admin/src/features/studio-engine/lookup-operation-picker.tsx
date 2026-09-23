import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  listRequestOperations,
  type RequestOperation,
} from "@savia/studio-shared/request-page";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import "./lookup-operation-picker.css";

export function LookupOperationPicker({
  operations,
  excludedIds,
  disabled = false,
  pending = false,
  onSelect,
}: {
  operations: RequestOperation[];
  excludedIds: string[];
  disabled?: boolean;
  pending?: boolean;
  onSelect: (operation: RequestOperation) => void;
}) {
  const t = useMessages(recordsMessages);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const availableCount = useMemo(
    () =>
      listRequestOperations(operations, "", { excludeIds: excludedIds }).length,
    [excludedIds, operations],
  );
  const matches = useMemo(
    () => listRequestOperations(operations, query, { excludeIds: excludedIds }),
    [excludedIds, operations, query],
  );
  const trimmedQuery = query.trim();
  const resultLabel = trimmedQuery
    ? `${matches.length} coincidencias`
    : t("%{p0} consultas disponibles", { p0: matches.length });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="lookup-operation-picker-trigger"
          aria-label={t("Añadir consulta")}
          disabled={disabled || pending || availableCount === 0}
        >
          <span
            className="lookup-operation-picker-trigger-icon"
            aria-hidden="true"
          >
            <Search size={16} />
          </span>
          <span className="lookup-operation-picker-trigger-label">
            {pending
              ? t("Cargando requests…")
              : availableCount === 0
                ? t("No hay consultas disponibles")
                : t("Buscar y añadir consulta…")}
          </span>
          <ChevronDown
            size={16}
            className="lookup-operation-picker-trigger-chevron"
            aria-hidden="true"
          />
        </button>
      </DialogTrigger>
      <DialogContent className="lookup-operation-picker-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Buscar consulta")}</DialogTitle>
          <DialogDescription>
            {t(
              "Filtra por nombre o identificador del request y elige la operación de lookup que quieres vincular a este campo.",
            )}
          </DialogDescription>
        </DialogHeader>
        <label className="lookup-operation-picker-search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label={t("Buscar consulta")}
            placeholder={t("Buscar por nombre, id u operationId…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </label>
        <p className="lookup-operation-picker-meta">{resultLabel}</p>
        {matches.length ? (
          <div className="lookup-operation-picker-list" role="listbox">
            {matches.map((operation) => (
              <button
                key={operation.id}
                type="button"
                role="option"
                className="lookup-operation-picker-item"
                onClick={() => {
                  onSelect(operation);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="lookup-operation-picker-item-title">
                  {operation.label}
                </span>
                <span className="lookup-operation-picker-item-id">
                  {operation.id}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="lookup-operation-picker-empty">
            {trimmedQuery
              ? t("No hay consultas que coincidan con «%{p0}».", { p0: query })
              : t("No quedan consultas disponibles para este campo.")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
