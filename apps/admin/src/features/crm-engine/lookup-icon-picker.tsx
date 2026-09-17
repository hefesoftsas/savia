import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  listLookupIcons,
  LOOKUP_ICON_LIBRARY_LABELS,
  LOOKUP_ICON_SEARCH_MIN_LENGTH,
  lookupIconCatalogSize,
  lookupIconLabel,
  lookupIconLibrary,
  type LookupIcon,
  type LookupIconLibrary,
} from "@savia/crm-shared/request-page";
import { LookupIconPreview } from "./lookup-icon-preview";
import { LookupIconVirtualGrid } from "./lookup-icon-virtual-grid";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import "./lookup-icon-picker.css";

export function LookupIconPicker({
  value,
  onChange,
  libraries = ["lucide", "thesvg"],
  "aria-label": ariaLabel = "Icono del botón",
}: {
  value: LookupIcon;
  onChange: (icon: LookupIcon) => void;
  libraries?: readonly LookupIconLibrary[];
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const resolveLibrary = (icon: LookupIcon) => {
    const current = lookupIconLibrary(icon);
    return libraries.includes(current) ? current : (libraries[0] ?? "lucide");
  };
  const [library, setLibrary] = useState<LookupIconLibrary>(() =>
    resolveLibrary(value),
  );

  const listedIcons = useMemo(
    () => listLookupIcons(query, library),
    [library, query],
  );
  const trimmedQuery = query.trim();
  const catalogSize = lookupIconCatalogSize(library);
  const isBrowseMode = trimmedQuery.length === 0;
  const isQueryTooShort =
    trimmedQuery.length > 0 &&
    trimmedQuery.length < LOOKUP_ICON_SEARCH_MIN_LENGTH;
  const resultLabel = isBrowseMode
    ? library === "thesvg"
      ? `${catalogSize} marcas · desplázate para explorar · busca para filtrar`
      : `${catalogSize} iconos · desplázate para explorar · busca para filtrar`
    : isQueryTooShort
      ? `Escribe al menos ${LOOKUP_ICON_SEARCH_MIN_LENGTH} caracteres para buscar entre ${catalogSize} iconos`
      : `${listedIcons.length} coincidencias de ${catalogSize}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setQuery("");
        } else {
          setLibrary(resolveLibrary(value));
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="lookup-icon-picker-trigger"
          aria-label={ariaLabel}
        >
          <span
            className="lookup-icon-picker-trigger-preview"
            aria-hidden="true"
          >
            <LookupIconPreview icon={value} className="size-4" />
          </span>
          <span className="lookup-icon-picker-trigger-label">
            {lookupIconLabel(value)}
          </span>
          <ChevronDown
            size={16}
            className="lookup-icon-picker-trigger-chevron"
            aria-hidden="true"
          />
        </button>
      </DialogTrigger>
      <DialogContent className="lookup-icon-picker-dialog sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Elegir icono</DialogTitle>
          <DialogDescription>
            {libraries.length === 1
              ? "Elige un icono de interfaz para identificar esta pantalla en el menú."
              : "Iconos de interfaz (Lucide) y logotipos de marcas (@thesvg). El seleccionado aparece en el botón de consulta junto al campo."}
          </DialogDescription>
        </DialogHeader>
        {libraries.length > 1 ? (
          <div
            className="lookup-icon-picker-libraries"
            role="tablist"
            aria-label="Biblioteca de iconos"
          >
            {libraries.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={library === entry}
                className={[
                  "lookup-icon-picker-library",
                  library === entry ? "lookup-icon-picker-library--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setLibrary(entry);
                  setQuery("");
                }}
              >
                {LOOKUP_ICON_LIBRARY_LABELS[entry]}
              </button>
            ))}
          </div>
        ) : null}
        <label className="lookup-icon-picker-search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label="Buscar icono"
            placeholder={
              library === "thesvg"
                ? "Buscar marca, por ejemplo HubSpot, Excel, Mercado Pago…"
                : "Buscar icono, por ejemplo lupa, vehículo, guardar…"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </label>
        <p className="lookup-icon-picker-meta">{resultLabel}</p>
        {listedIcons.length ? (
          <LookupIconVirtualGrid
            icons={listedIcons}
            value={value}
            brand={library === "thesvg"}
            active={open}
            ariaLabel={ariaLabel}
            onSelect={(icon) => {
              onChange(icon);
              setOpen(false);
            }}
          />
        ) : (
          <p className="lookup-icon-picker-empty">
            {isQueryTooShort
              ? `Escribe al menos ${LOOKUP_ICON_SEARCH_MIN_LENGTH} caracteres para buscar.`
              : `No hay iconos que coincidan con «${query}».`}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
