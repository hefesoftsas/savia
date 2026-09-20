import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import type { IFieldProps } from "@form-eng/core";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
function NumericInput({
  props,
  rating = false,
}: {
  props: IFieldProps;
  rating?: boolean;
}) {
  const id = String(props.config?.inputId ?? props.fieldName);
  const update = (raw: string) => {
    if (!props.readOnly)
      props.setFieldValue?.(props.fieldName!, raw === "" ? null : Number(raw));
  };
  return (
    <Input
      id={id}
      name={props.fieldName}
      type="number"
      aria-labelledby={`${id}_label`}
      aria-required={props.required}
      aria-invalid={!!props.error}
      required={props.required}
      readOnly={props.readOnly}
      min={rating ? 1 : Number(props.config?.minimum ?? 0)}
      max={Number(props.config?.maximum ?? (rating ? 5 : 100))}
      step={rating ? 1 : 10 ** -Number(props.config?.decimals ?? 2)}
      value={typeof props.value === "number" ? props.value : ""}
      onInput={(event) => update(event.currentTarget.value)}
      onChange={(event) => update(event.currentTarget.value)}
    />
  );
}
export function PercentageField(props: IFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <NumericInput props={props} />
      <span aria-hidden="true">%</span>
    </div>
  );
}
export function RatingField(props: IFieldProps) {
  const t = useMessages(recordsMessages);

  if (props.config?.ratingStyle === "number")
    return <NumericInput props={props} rating />;
  const id = String(props.config?.inputId ?? props.fieldName);
  const max = Math.max(1, Math.min(10, Number(props.config?.maximum ?? 5)));
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-labelledby={`${id}_label`}
        aria-required={props.required}
        aria-invalid={!!props.error}
        className="flex flex-wrap gap-1"
      >
        {Array.from({ length: max }, (_, index) => index + 1).map((score) => (
          <label key={score} className="cursor-pointer">
            <input
              type="radio"
              className="peer sr-only"
              name={id}
              aria-label={t("%{p0} of %{p1}", { p0: score, p1: max })}
              checked={props.value === score}
              disabled={props.readOnly}
              onChange={() => {
                if (!props.readOnly)
                  props.setFieldValue?.(props.fieldName!, score);
              }}
            />
            <span className="flex size-10 items-center justify-center rounded-md border peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
              <Star
                aria-hidden="true"
                size={20}
                className={
                  Number(props.value) >= score
                    ? "fill-current text-primary"
                    : "text-muted-foreground"
                }
              />
            </span>
          </label>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={props.readOnly || props.value == null}
        onClick={() => props.setFieldValue?.(props.fieldName!, null)}
      >
        {t("Clear rating")}
      </Button>
    </div>
  );
}
