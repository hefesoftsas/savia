import { recordOptionLabel } from "./record-option-label";
import { intlLocale, useAppLocale } from "@/i18n/core";
import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { Star } from "lucide-react";
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
  const uiLocale = intlLocale(useAppLocale());

  const t = useMessages(recordsMessages);

  if (
    field.type === "Rating" &&
    typeof value === "number" &&
    field.config?.ratingStyle !== "number"
  ) {
    const max = Math.max(1, Math.min(10, Number(field.config?.maximum ?? 5)));
    return (
      <span
        role="img"
        aria-label={t("%{p0} of %{p1}", { p0: value, p1: max })}
        className="inline-flex flex-wrap gap-0.5"
      >
        {Array.from({ length: max }, (_, index) => (
          <Star
            key={index}
            aria-hidden="true"
            size={16}
            className={
              value > index
                ? "fill-current text-primary"
                : "text-muted-foreground"
            }
          />
        ))}
      </span>
    );
  }
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
              recordOptionLabel(
                item,
                field.options,
                uiLocale.startsWith("pt")
                  ? "pt"
                  : uiLocale.startsWith("en")
                    ? "en"
                    : "es",
              ),
            )}
          </Badge>
        ))}
      </div>
    );
  return <>{formatFieldValue(value, field, uiLocale)}</>;
}
