import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Columns3, ListFilter, Search, Table2, Trash2 } from "lucide-react";
import MicrosoftExcel from "@thesvg/react/microsoft-excel";
import { useEffect, useState } from "react";
import type { CollectionCapabilities } from "./collection-capabilities";
import {
  RecordsFiltersPanel,
  type RecordsFilterCondition,
  type RecordsFilters,
} from "./records-filters-panel";
import type { CrmObject } from "@savia/crm-shared/metadata";

const emptyFilters = (): RecordsFilters => ({
  logic: "and",
  conditions: [],
});

export function RecordsCommandToolbar({
  object,
  capabilities,
  searchField,
  searchQuery,
  onSearchFieldChange,
  onSearchQueryChange,
  searchOptions,
  filters,
  onFiltersChange,
  canExportCsv,
  onExportCsv,
  trash,
  onTrashToggle,
  showPipelineToggle,
  mode,
  onModeChange,
  stage,
  onStageChange,
  pipelineFieldLabel,
  stageOptions,
  supportsLocalRecordTools,
  showDelete,
}: {
  object: CrmObject;
  capabilities: CollectionCapabilities;
  searchField: string;
  searchQuery: string;
  onSearchFieldChange: (field: string) => void;
  onSearchQueryChange: (query: string) => void;
  searchOptions: Array<{ key: string; label: string }>;
  filters: RecordsFilters;
  onFiltersChange: (next: RecordsFilters) => void;
  canExportCsv: boolean;
  onExportCsv: () => void;
  trash: boolean;
  onTrashToggle: () => void;
  showPipelineToggle: boolean;
  mode: "table" | "pipeline";
  onModeChange: (mode: "table" | "pipeline") => void;
  stage: string;
  onStageChange: (stage: string) => void;
  pipelineFieldLabel?: string;
  stageOptions: Array<{ value: string; label: string }>;
  supportsLocalRecordTools: boolean;
  showDelete: boolean;
}) {
  const t = useMessages(recordsMessages);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(filters);
  const activeFilters = filters.conditions.length;
  const searchEnabled = capabilities.search !== false;
  const filtersEnabled = capabilities.filter !== false;

  useEffect(() => {
    if (filtersOpen) setDraftFilters(filters);
  }, [filtersOpen, filters]);

  const updateDraftCondition = (
    index: number,
    value: Partial<RecordsFilterCondition>,
  ) => {
    setDraftFilters({
      ...draftFilters,
      conditions: draftFilters.conditions.map((condition, current) =>
        current === index ? { ...condition, ...value } : condition,
      ),
    });
  };

  const applyFilters = () => {
    onFiltersChange(draftFilters);
    setFiltersOpen(false);
  };

  const clearFilters = () => {
    const cleared = emptyFilters();
    setDraftFilters(cleared);
    onFiltersChange(cleared);
    setFiltersOpen(false);
  };

  return (
    <section
      className="records-command-toolbar"
      aria-label={t("Comandos de la tabla")}
    >
      {searchEnabled && (
        <div className="records-command-search">
          {object.config.studio?.collection?.kind !== "crm" && (
            <label className="records-command-field">
              <span className="view-config-sr-only">
                {t("Buscar por campo")}
              </span>
              <select
                aria-label={t("Buscar por campo")}
                className="select-input"
                value={searchField}
                onChange={(event) => onSearchFieldChange(event.target.value)}
              >
                <option value="">{t("Todos los campos")}</option>
                {searchOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="search-wrap">
            <Search size={17} aria-hidden="true" />
            <Input
              aria-label={
                object.config.studio?.collection?.kind !== "crm" && searchField
                  ? t("Buscar en %{p0}", {
                      p0:
                        object.config.fields[searchField]?.label ?? searchField,
                    })
                  : t("Buscar en %{p0}", { p0: object.label.toLowerCase() })
              }
              placeholder={
                object.config.studio?.collection?.kind !== "crm" && searchField
                  ? t("Buscar en %{p0}…", {
                      p0:
                        object.config.fields[searchField]?.label ?? searchField,
                    })
                  : t("Buscar en %{p0}…", { p0: object.label.toLowerCase() })
              }
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
            />
          </div>
        </div>
      )}
      <div className="records-command-actions">
        {stageOptions.length > 0 && capabilities.filter !== false && (
          <label className="records-command-field">
            <span className="view-config-sr-only">
              {pipelineFieldLabel ?? t("Etapa")}
            </span>
            <select
              aria-label={pipelineFieldLabel ?? t("Filtrar por etapa")}
              className="select-input"
              value={stage}
              onChange={(event) => onStageChange(event.target.value)}
            >
              <option value="">{t("Todas las etapas")}</option>
              {stageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {filtersEnabled && (
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="records-command-filter-trigger"
                    aria-label={t("Filtros")}
                  >
                    <ListFilter size={15} />
                    {activeFilters > 0 && (
                      <span className="records-command-badge">
                        {activeFilters}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t("Filtros")}
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              className="records-filters-popover"
              sideOffset={8}
            >
              <div className="records-filters-popover-header">
                <h3>{t("Filtros")}</h3>
                <p>
                  {t("Combina condiciones para acotar los registros visibles.")}
                </p>
              </div>
              <RecordsFiltersPanel
                object={object}
                filters={draftFilters}
                onFiltersChange={setDraftFilters}
                onConditionChange={updateDraftCondition}
              />
              <div className="records-filters-popover-footer">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  disabled={
                    !draftFilters.conditions.length &&
                    !filters.conditions.length
                  }
                >
                  {t("Limpiar")}
                </Button>
                <Button type="button" size="sm" onClick={applyFilters}>
                  {t("Aplicar")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        {canExportCsv && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("Exportar a CSV")}
                onClick={onExportCsv}
              >
                <MicrosoftExcel aria-hidden className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("Exportar a CSV")}
            </TooltipContent>
          </Tooltip>
        )}
        {supportsLocalRecordTools && showDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={trash ? "secondary" : "ghost"}
                size="icon"
                aria-label={t("Papelera")}
                onClick={onTrashToggle}
              >
                <Trash2 size={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("Papelera")}
            </TooltipContent>
          </Tooltip>
        )}
        {showPipelineToggle && !trash && (
          <div className="segmented">
            <button
              type="button"
              className={mode === "table" ? "selected" : ""}
              onClick={() => onModeChange("table")}
            >
              <Table2 size={15} />
              {t("Tabla")}
            </button>
            <button
              type="button"
              className={mode === "pipeline" ? "selected" : ""}
              onClick={() => onModeChange("pipeline")}
            >
              <Columns3 size={15} />
              {t("Pipeline")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
