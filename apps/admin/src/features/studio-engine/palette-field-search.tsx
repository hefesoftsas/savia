import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import { Input } from "@/components/ui/input";
import { StudioControlLabel } from "./studio-control-label";

export function PaletteTypeSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const t = useMessages(studioMessages);
  return (
    <label className="studio-control palette-field-search">
      <StudioControlLabel
        label={t("Buscar tipo de campo")}
        help={t("Filtra los tipos que puedes agregar al formulario.")}
      />
      <Input
        type="search"
        placeholder={t("texto, número, fecha…")}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </label>
  );
}
