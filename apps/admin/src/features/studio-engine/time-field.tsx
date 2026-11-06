import type { IFieldProps } from "@form-eng/core";
import { Input } from "@/components/ui/input";
export function TimeField(props: IFieldProps) {
  const id = String(props.config?.inputId ?? props.fieldName);
  function update(value: string) {
    if (!props.readOnly && value !== props.value)
      props.setFieldValue?.(props.fieldName!, value);
  }
  return (
    <Input
      type="time"
      step={60}
      id={id}
      name={props.fieldName}
      aria-labelledby={`${id}_label`}
      aria-invalid={!!props.error}
      aria-required={props.required}
      required={props.required}
      readOnly={props.readOnly}
      value={typeof props.value === "string" ? props.value : ""}
      onChange={(event) => update(event.currentTarget.value)}
      onInput={(event) => update(event.currentTarget.value)}
      onBlur={(event) => update(event.currentTarget.value)}
    />
  );
}
