import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { fieldEntries, type CrmObject } from "@savia/crm-shared/metadata";

export type RecordsFilterCondition = {
  field: string;
  op: string;
  value?: unknown;
};
export type RecordsFilters = {
  logic: "and" | "or";
  conditions: RecordsFilterCondition[];
};

const FILTER_OPERATORS: Record<string, string> = {
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
  object: CrmObject;
  filters: RecordsFilters;
  onFiltersChange: (next: RecordsFilters) => void;
  onConditionChange: (
    index: number,
    value: Partial<RecordsFilterCondition>,
  ) => void;
}) {
  const fields = fieldEntries(object);
  const firstField = fields[0]?.[0] ?? "";
  return (
    <div className="records-filters-panel">
      <select
        aria-label="Combinar filtros"
        className="select-input"
        value={filters.logic}
        onChange={(event) =>
          onFiltersChange({
            ...filters,
            logic: event.target.value as "and" | "or",
          })
        }
      >
        <option value="and">Cumplir todos (Y)</option>
        <option value="or">Cumplir cualquiera (O)</option>
      </select>
      {filters.conditions.map((condition, index) => (
        <div className="filter-row" key={`${condition.field}-${index}`}>
          <select
            aria-label={`Campo del filtro ${index + 1}`}
            className="select-input"
            value={condition.field}
            onChange={(event) =>
              onConditionChange(index, { field: event.target.value, value: "" })
            }
          >
            {fields.map(([key, field]) => (
              <option key={key} value={key}>
                {field.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`Operador del filtro ${index + 1}`}
            className="select-input"
            value={condition.op}
            onChange={(event) =>
              onConditionChange(index, { op: event.target.value })
            }
          >
            {Object.entries(FILTER_OPERATORS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {condition.op !== "empty" &&
            (object.config.fields[condition.field]?.type === "Toggle" ? (
              <select
                aria-label={`Valor del filtro ${index + 1}`}
                value={String(condition.value)}
                onChange={(event) =>
                  onConditionChange(index, {
                    value: event.target.value === "true",
                  })
                }
              >
                <option value="false">No</option>
                <option value="true">Sí</option>
              </select>
            ) : (
              <Input
                aria-label={`Valor del filtro ${index + 1}`}
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
            aria-label={`Quitar filtro ${index + 1}`}
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
        Añadir filtro
      </Button>
    </div>
  );
}
