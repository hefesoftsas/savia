import { useEffect, useState } from "react";
import { useLocaleState } from "ra-core";
import { Input } from "@/components/ui/input";
import {
  fieldLabelLocales,
  isFieldLabelLocale,
  normalizeFieldLabels,
  resolveFieldLabel,
  type FieldLabelLocale,
  type FieldLabelSource,
  type FieldLabels,
} from "@savia/crm-shared/field-labels";
import { StudioHelpTooltip } from "./studio-help-tooltip";

const localeNames: Record<FieldLabelLocale, string> = {
  es: "ES",
  en: "EN",
  pt: "PT",
};

export function useFieldLabelLocale(): FieldLabelLocale {
  const [locale] = useLocaleState();
  return isFieldLabelLocale(locale) ? locale : "es";
}

export function useResolvedFieldLabel(field: FieldLabelSource): string {
  const locale = useFieldLabelLocale();
  return resolveFieldLabel(field, locale);
}

type LocalizedFieldLabelEditorProps = {
  field: FieldLabelSource;
  onChange(next: { label: string; labels?: FieldLabels }): void;
};

export function LocalizedFieldLabelEditor({
  field,
  onChange,
}: LocalizedFieldLabelEditorProps) {
  const uiLocale = useFieldLabelLocale();
  const [activeLocale, setActiveLocale] = useState<FieldLabelLocale>(uiLocale);

  useEffect(() => {
    setActiveLocale(uiLocale);
  }, [uiLocale]);

  const localizedValue =
    activeLocale === "es" ? field.label : (field.labels?.[activeLocale] ?? "");

  return (
    <div className="studio-localized-label">
      <div className="studio-localized-label-header">
        <div
          className="studio-localized-label-tabs"
          role="tablist"
          aria-label="Idioma de la etiqueta"
        >
          {fieldLabelLocales.map((locale) => (
            <button
              key={locale}
              type="button"
              role="tab"
              aria-selected={activeLocale === locale}
              className={
                activeLocale === locale
                  ? "studio-localized-label-tab studio-localized-label-tab--active"
                  : "studio-localized-label-tab"
              }
              onClick={() => setActiveLocale(locale)}
            >
              {localeNames[locale]}
            </button>
          ))}
        </div>
        {activeLocale !== "es" ? (
          <StudioHelpTooltip label="Traducción opcional">
            Si falta la traducción, se mostrará «{field.label.trim() || "…"}».
          </StudioHelpTooltip>
        ) : null}
      </div>
      <Input
        role="tabpanel"
        aria-label={`Etiqueta ${localeNames[activeLocale]}`}
        value={localizedValue}
        placeholder={
          activeLocale === "es"
            ? "Etiqueta principal"
            : `Traducción ${localeNames[activeLocale]} (opcional)`
        }
        onChange={(event) => {
          const value = event.target.value;
          if (activeLocale === "es") {
            onChange({
              label: value,
              labels: field.labels ?? undefined,
            });
            return;
          }
          onChange({
            label: field.label,
            labels: normalizeFieldLabels({
              ...field.labels,
              [activeLocale]: value.trim() ? value : undefined,
            }),
          });
        }}
      />
    </div>
  );
}
