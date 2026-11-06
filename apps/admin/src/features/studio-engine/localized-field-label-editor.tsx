import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
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
} from "@savia/studio-shared/field-labels";
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
  const t = useMessages(studioMessages);
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
          aria-label={t("Idioma de la etiqueta")}
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
          <StudioHelpTooltip label={t("Traducción opcional")}>
            {t("Si falta la traducción, se mostrará «")}
            {field.label.trim() || "…"}».
          </StudioHelpTooltip>
        ) : null}
      </div>
      <Input
        role="tabpanel"
        aria-label={t("Etiqueta %{v1}", { v1: localeNames[activeLocale] })}
        value={localizedValue}
        placeholder={
          activeLocale === "es"
            ? t("Etiqueta principal")
            : t("Traducción %{v1} (opcional)", {
                v1: localeNames[activeLocale],
              })
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
