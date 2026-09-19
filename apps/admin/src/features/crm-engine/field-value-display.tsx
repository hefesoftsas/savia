import type { IFieldConfig } from "@form-eng/core";
import { Badge } from "@/components/ui/badge";
import { formatFieldValue } from "./field-value";
import { RichTextValue } from "./rich-text-field";
export function FieldValueDisplay({
  value,
  field,
}: {
  value: unknown;
  field: IFieldConfig;
}) {
  if (field.type === "RichText" && typeof value === "string" && value.trim())
    return <RichTextValue value={value} />;
  if (field.type === "MultiSelect" && Array.isArray(value) && value.length)
    return (
      <div className="flex flex-wrap gap-1">
        {[...new Set(value.map(String))].map((item) => (
          <Badge
            key={item}
            variant="secondary"
            className="max-w-full whitespace-normal break-words"
          >
            {String(
              field.options?.find((option) => String(option.value) === item)
                ?.label ?? item,
            )}
          </Badge>
        ))}
      </div>
    );
  return <>{formatFieldValue(value, field)}</>;
}
