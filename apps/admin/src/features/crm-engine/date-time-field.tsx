import type { IFieldProps } from "@form-eng/core";
import { Input } from "@/components/ui/input";

export function localDateTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateTimeField(props: IFieldProps) {
  function update(value: string) {
    if (props.readOnly || value === localDateTime(props.value)) return;
    if (!value) {
      props.setFieldValue?.(props.fieldName!, "");
      return;
    }
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) props.setFieldValue?.(props.fieldName!, date.toISOString());
  }
  return <Input
    type="datetime-local"
    id={props.fieldName}
    name={props.fieldName}
    aria-labelledby={`${props.fieldName}_label`}
    aria-invalid={!!props.error}
    aria-required={props.required}
    required={props.required}
    readOnly={props.readOnly}
    value={localDateTime(props.value)}
    onChange={(event) => update(event.currentTarget.value)}
    onInput={(event) => update(event.currentTarget.value)}
    onBlur={(event) => update(event.currentTarget.value)}
  />;
}
