import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StudioHelpTooltip } from "./studio-help-tooltip";

export function PropertyPanelSearch({
  query,
  onQueryChange,
  matchCount = 0,
  filtering = false,
  ariaLabel = "Buscar propiedad",
}: {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount?: number;
  filtering?: boolean;
  ariaLabel?: string;
}) {
  const trimmedQuery = query.trim();

  return (
    <div className="studio-properties-search">
      <div className="studio-properties-search-input-wrap">
        <Search
          size={15}
          aria-hidden="true"
          className="studio-properties-search-icon"
        />
        <Input
          type="search"
          className="studio-properties-search-input"
          aria-label={ariaLabel}
          placeholder="etiqueta, obligatorio, consulta…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && trimmedQuery) {
              event.preventDefault();
              onQueryChange("");
            }
          }}
        />
        {trimmedQuery ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="studio-properties-search-clear"
            aria-label="Limpiar búsqueda"
            onClick={() => onQueryChange("")}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        ) : (
          <div className="studio-properties-search-help">
            <StudioHelpTooltip label="Ayuda sobre la búsqueda">
              Filtra las opciones visibles en este panel.
            </StudioHelpTooltip>
          </div>
        )}
      </div>
      {filtering ? (
        <div className="studio-properties-search-meta">
          <span className="studio-properties-search-count" aria-live="polite">
            {matchCount} coincidencia{matchCount === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
