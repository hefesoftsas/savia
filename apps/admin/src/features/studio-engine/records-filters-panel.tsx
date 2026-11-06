import { resolveFieldLabel } from "@savia/studio-shared/field-labels";
import { useAppLocale, useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { fieldEntries, type StudioObject } from "@savia/studio-shared/metadata";

export type RecordsFilterCondition = {
  field: string;
  op: string;
  value?: unknown;
};
export type RecordsFilters = {
  logic: "and" | "or";
  conditions: RecordsFilterCondition[];
};

const FILTER_OPERATORS: Record<string, keyof typeof recordsMessages> = {
  eq: "Igual",
  ne: "Diferente",
  contains: "Contiene",
  startsWith: "Empieza por",
  endsWith: "Termina por",
  gt: "Mayor",
  gte: "Mayor o igual",
  lt: "Menor",
  lte: "Menor o igual",
  empty: "Vacío",
};

export function RecordsFiltersPanel({
  object,
  filters,
  onFiltersChange,
  onConditionChange,
}: {
  object: StudioObject;
  filters: RecordsFilters;
  onFiltersChange: (next: RecordsFilters) => void;
  onConditionChange: (
    index: number,
    value: Partial<RecordsFilterCondition>,
  ) => void;
}) {
  const t = useMessages(recordsMessages);
  const labelLocale = useAppLocale();

  const fields = fieldEntries(object);
  const firstField = fields[0]?.[0] ?? "";
  return (
    <div className="records-filters-panel">
      <select
        aria-label={t("Combinar filtros")}
        className="select-input"
        value={filters.logic}
        onChange={(event) =>
          onFiltersChange({
            ...filters,
            logic: event.target.value as "and" | "or",
          })
        }
      >
        <option value="and">{t("Cumplir todos (Y)")}</option>
        <option value="or">{t("Cumplir cualquiera (O)")}</option>
      </select>
      {filters.conditions.map((condition, index) => (
        <div className="filter-row" key={`${condition.field}-${index}`}>
          <select
            aria-label={t("Campo del filtro %{p0}", { p0: index + 1 })}
            className="select-input"
            value={condition.field}
            onChange={(event) =>
              onConditionChange(index, { field: event.target.value, value: "" })
            }
          >
            {fields.map(([key, field]) => (
              <option key={key} value={key}>
                {resolveFieldLabel(field, labelLocale)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Operador del filtro %{p0}", { p0: index + 1 })}
            className="select-input"
            value={condition.op}
            onChange={(event) =>
              onConditionChange(index, { op: event.target.value })
            }
          >
            {Object.entries(FILTER_OPERATORS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
          {condition.op !== "empty" &&
            (object.config.fields[condition.field]?.type === "Toggle" ? (
              <select
                aria-label={t("Valor del filtro %{p0}", { p0: index + 1 })}
                value={String(condition.value)}
                onChange={(event) =>
                  onConditionChange(index, {
                    value: event.target.value === "true",
                  })
                }
              >
                <option value="false">{t("No")}</option>
                <option value="true">{t("Sí")}</option>
              </select>
            ) : (
              <Input
                aria-label={t("Valor del filtro %{p0}", { p0: index + 1 })}
                type={
                  ["Number", "Currency", "Percentage", "Rating"].includes(
                    object.config.fields[condition.field]?.type ?? "",
                  )
                    ? "number"
                    : "text"
                }
                value={String(condition.value ?? "")}
                onChange={(event) =>
                  onConditionChange(index, {
                    value:
                      ["Number", "Currency", "Percentage", "Rating"].includes(
                        object.config.fields[condition.field]?.type ?? "",
                      ) && event.target.value !== ""
                        ? Number(event.target.value)
                        : event.target.value,
                  })
                }
              />
            ))}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Quitar filtro %{p0}", { p0: index + 1 })}
            onClick={() =>
              onFiltersChange({
                ...filters,
                conditions: filters.conditions.filter(
                  (_, current) => current !== index,
                ),
              })
            }
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={!firstField || filters.conditions.length >= 20}
        onClick={() =>
          onFiltersChange({
            ...filters,
            conditions: [
              ...filters.conditions,
              {
                field: firstField,
                op: "contains",
                value: "",
              },
            ],
          })
        }
      >
        <Plus size={14} />
        {t("Añadir filtro")}
      </Button>
    </div>
  );
}
