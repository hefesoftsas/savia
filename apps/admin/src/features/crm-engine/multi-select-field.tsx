import { resolveOptionLabel } from "@savia/crm-shared/field-labels";
import { useAppLocale, useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import type { IFieldProps } from "@form-eng/core";
import { Checkbox } from "@/components/ui/checkbox";
export function MultiSelectField(props: IFieldProps) {
  const t = useMessages(recordsMessages);
  const locale = useAppLocale();

  const selected = Array.isArray(props.value) ? props.value.map(String) : [];
  const id = String(props.config?.inputId ?? props.fieldName);
  return (
    <div
      role="group"
      aria-labelledby={`${id}_label`}
      aria-invalid={!!props.error}
      className="space-y-2"
    >
      {(props.options ?? []).map((option, index) => (
        <label
          key={String(option.value)}
          className="flex items-center gap-2"
          htmlFor={`${id}_${index}`}
        >
          <Checkbox
            id={`${id}_${index}`}
            checked={selected.includes(String(option.value))}
            disabled={props.readOnly}
            onCheckedChange={(checked) => {
              if (!props.readOnly)
                props.setFieldValue?.(
                  props.fieldName!,
                  checked === true
                    ? [...new Set([...selected, String(option.value)])]
                    : selected.filter(
                        (value) => value !== String(option.value),
                      ),
                );
            }}
          />
          <span>{resolveOptionLabel(option, locale)}</span>
        </label>
      ))}
      {!props.options?.length && (
        <p className="text-sm text-muted-foreground">
          {t("No options configured.")}
        </p>
      )}
    </div>
  );
}
