import { useAppLocale } from "@/i18n/core";
import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
} from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import type { IFieldProps } from "@form-eng/core";
import {
  fieldEntries,
  validateRecord,
  type StudioObject,
} from "@savia/studio-shared/metadata";
import {
  evaluateCondition,
  isSectionVisible,
  prepareRecord,
} from "@savia/studio-shared/rules";
import { registry } from "./fields";
import { DateTimeField } from "./date-time-field";
import { CollectionOptionField } from "./collection-option-field";
import { Button } from "@/components/ui/button";

export function RelatedRecordSubform({
  object,
  values,
  onChange,
  onClose,
}: {
  object: StudioObject;
  values: Record<string, unknown>;
  onChange: (data: Record<string, unknown>, errors: string[]) => void;
  onClose: () => void;
}) {
  const t = useMessages(recordsMessages);
  const validationLocale = useAppLocale();

  const inputPrefix = useId();
  const defaults = Object.fromEntries(
    fieldEntries(object).map(([name, field]) => [
      name,
      values[name] ??
        field.defaultValue ??
        (field.type === "Toggle" ? false : ""),
    ]),
  );
  const methods = useForm<Record<string, unknown>>({ defaultValues: defaults });
  const data = useWatch({ control: methods.control });
  const serialized = JSON.stringify(data);
  const initial = useRef<string | undefined>(undefined);
  const callback = useRef(onChange);
  callback.current = onChange;
  const validation = validateRecord(object, data, validationLocale);
  useEffect(() => {
    const validationKey = `${validationLocale}:${serialized}`;
    if (validationKey === initial.current) return;
    initial.current = validationKey;
    const result = validateRecord(
      object,
      JSON.parse(serialized),
      validationLocale,
    );
    callback.current(result.data, Object.values(result.errors));
  }, [serialized, object, validationLocale]);
  let prepared: Record<string, unknown> = data;
  try {
    prepared = prepareRecord(object, data);
  } catch {
    /* Shared validation shows the error below. */
  }
  return (
    <FormProvider {...methods}>
      <fieldset
        className="space-y-4 rounded-md border p-4"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.target as HTMLElement).tagName !== "TEXTAREA"
          )
            event.preventDefault();
        }}
      >
        <legend className="px-1 text-sm font-medium">
          {t("Editar relacionado")}
        </legend>
        <p className="text-sm text-muted-foreground">
          {t(
            "Los cambios se incluyen al guardar el formulario principal. Los archivos y las relaciones anidadas se editan desde el registro original.",
          )}
        </p>
        {fieldEntries(object).map(([name, field]) => {
          const section = object.config.studio?.sections?.find(
            (item) => item.id === field.config?.section,
          );
          if (
            field.hidden ||
            !isSectionVisible(section, prepared) ||
            !evaluateCondition(field.config?.visibleWhen as never, prepared)
          )
            return null;
          const element = registry[field.type as keyof typeof registry] as
            ReactElement<IFieldProps> | undefined;
          if (!element) return null;
          const props: IFieldProps = {
            ...field,
            fieldName: name,
            value: data[name],
            required:
              !!field.required ||
              (!!field.config?.requiredWhen &&
                evaluateCondition(
                  field.config.requiredWhen as never,
                  prepared,
                )),
            readOnly: field.readOnly || !!field.config?.formula,
            config: {
              ...field.config,
              studioObject: object,
              inputId: `${inputPrefix}-${name}`,
            },
            setFieldValue: (key, value) =>
              methods.setValue(key, value, { shouldDirty: true }),
            error: validation.errors[name]
              ? { type: "validate", message: validation.errors[name] }
              : undefined,
          };
          return (
            <div key={name} className="space-y-1">
              <label
                id={`${inputPrefix}-${name}_label`}
                htmlFor={`${inputPrefix}-${name}`}
                className="text-sm font-medium"
              >
                {field.label}
                {props.required ? " *" : ""}
              </label>
              {field.description && (
                <p className="text-sm text-muted-foreground">
                  {field.description}
                </p>
              )}
              {field.config?.dateTime ? (
                <DateTimeField {...props} />
              ) : field.config?.collectionOptions ? (
                <CollectionOptionField
                  {...props}
                  objectName={object.name}
                  numeric={field.type === "Number" || field.type === "Currency"}
                />
              ) : (
                cloneElement(element, props)
              )}
              {validation.errors[name] && (
                <p role="alert" className="text-sm text-destructive">
                  {validation.errors[name]}
                </p>
              )}
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t("Cerrar edición")}
        </Button>
      </fieldset>
    </FormProvider>
  );
}
