import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import type { FieldLabels } from "@savia/crm-shared/field-labels";
import { LocalizedFieldLabelEditor } from "./localized-field-label-editor";

type StaticOption = {
  value: string | number;
  label: string;
  labels?: FieldLabels | null;
};

/** Edit the base list without discarding translations attached to stable values. */
export function parseStaticOptions(
  text: string,
  current: readonly StaticOption[],
): StaticOption[] {
  return text.split("\n").map((line) => {
    const [rawValue, ...parts] = line.split("|");
    const value = rawValue.trim();
    const previous = current.find((option) => String(option.value) === value);
    return {
      ...(previous ?? {}),
      value: previous?.value ?? value,
      label: parts.join("|").trim() || value,
    };
  });
}

export function StaticOptionLabelsEditor({
  options,
  onChange,
}: {
  options: readonly StaticOption[];
  onChange: (options: StaticOption[]) => void;
}) {
  const t = useMessages(studioMessages);
  return (
    <details className="space-y-3">
      <summary className="cursor-pointer text-sm">
        {t("Traducciones de opciones")}
      </summary>
      <p className="text-sm text-muted-foreground">
        {t(
          "Traduce las etiquetas sin cambiar los valores guardados. Si falta una traducción, se usa la etiqueta principal.",
        )}
      </p>
      {options.map((option, index) => (
        <fieldset key={index} className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm">{option.value}</legend>
          <LocalizedFieldLabelEditor
            field={option}
            onChange={(next) =>
              onChange(
                options.map((existing, i) =>
                  i === index ? { ...existing, ...next } : existing,
                ),
              )
            }
          />
        </fieldset>
      ))}
    </details>
  );
}
