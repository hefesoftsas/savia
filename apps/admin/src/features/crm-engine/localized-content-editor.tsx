import { useMessages } from "@/i18n/core";
import type { PluginLocale } from "@savia/crm-shared/plugin-localization";
import { Textarea } from "@/components/ui/textarea";

const messages = {
  translations: [
    "Traducciones del contenido",
    "Content translations",
    "Traduções do conteúdo",
  ],
  fallback: [
    "Deja vacío para usar el contenido predeterminado.",
    "Leave blank to use the default content.",
    "Deixe vazio para usar o conteúdo padrão.",
  ],
} as const;

export function LocalizedContentEditor({
  value,
  onChange,
  maxLength = 100000,
}: {
  value?: Partial<Record<PluginLocale, string>>;
  onChange: (value: Partial<Record<PluginLocale, string>>) => void;
  maxLength?: number;
}) {
  const t = useMessages(messages);
  return (
    <details>
      <summary>{t("translations")}</summary>
      <p className="studio-field-help">{t("fallback")}</p>
      {(
        [
          ["es", "Español"],
          ["en", "English"],
          ["pt", "Português"],
        ] as const
      ).map(([locale, label]) => (
        <label key={locale} className="studio-control">
          <span>{label}</span>
          <Textarea
            value={value?.[locale] ?? ""}
            maxLength={maxLength}
            rows={3}
            onChange={(event) => {
              const next = { ...value };
              if (event.target.value) next[locale] = event.target.value;
              else delete next[locale];
              onChange(next);
            }}
          />
        </label>
      ))}
    </details>
  );
}
