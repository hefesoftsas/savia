import { Input } from "@/components/ui/input";
import { StudioControlLabel } from "./studio-control-label";

export function PaletteTypeSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <label className="studio-control palette-field-search">
      <StudioControlLabel
        label="Buscar tipo de campo"
        help="Filtra los tipos que puedes agregar al formulario."
      />
      <Input
        type="search"
        placeholder="texto, número, fecha…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </label>
  );
}
