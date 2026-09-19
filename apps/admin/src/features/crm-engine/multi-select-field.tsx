import type { IFieldProps } from "@form-eng/core";
import { Checkbox } from "@/components/ui/checkbox";
export function MultiSelectField(props: IFieldProps) {
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
          <span>{String(option.label)}</span>
        </label>
      ))}
      {!props.options?.length && (
        <p className="text-sm text-muted-foreground">No options configured.</p>
      )}
    </div>
  );
}
