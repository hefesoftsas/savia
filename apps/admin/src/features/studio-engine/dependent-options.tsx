import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect } from "react";
import { useWatch } from "react-hook-form";
import type { IFieldProps } from "@form-eng/core";
import {
  availableOptions,
  type OptionDependency,
} from "@savia/studio-shared/dependent-options";
import { isStaticOptionField } from "@savia/studio-shared/metadata";

export function useDependentOptions(props: IFieldProps) {
  const values = useWatch();
  const dependency = props.config?.optionsWhen as OptionDependency | undefined;
  const options = availableOptions(props.options, dependency, values);
  const invalid =
    !!dependency &&
    props.value != null &&
    props.value !== "" &&
    !options.some((o) => o.value === props.value);
  useEffect(() => {
    if (invalid && !props.readOnly) props.setFieldValue?.(props.fieldName!, "");
  }, [
    invalid,
    props.value,
    props.readOnly,
    props.fieldName,
    props.setFieldValue,
  ]);
  return {
    options,
    dependency,
    waiting:
      !!dependency &&
      (values[dependency.field] == null || values[dependency.field] === ""),
  };
}

export function DependentOptionsEditor({
  name,
  fields,
  value,
  onChange,
}: {
  name: string;
  fields: Record<string, any>;
  value?: OptionDependency;
  onChange: (value: OptionDependency | undefined) => void;
}) {
  const t = useMessages(recordsMessages);

  const field = fields[name];
  return (
    <fieldset
      className="dependent-options-editor"
      data-property-search="opciones dependientes cascada dropdown autocompletar"
    >
      <legend>{t("Opciones dependientes")}</legend>
      <label>
        {t("Depende de")}
        <select
          value={value?.field ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value ? { field: e.target.value, cases: {} } : undefined,
            )
          }
        >
          <option value="">{t("Sin dependencia")}</option>
          {Object.entries(fields)
            .filter(
              ([key, f]) =>
                key !== name &&
                isStaticOptionField(f.type) &&
                !f.config?.relation,
            )
            .map(([key, f]) => (
              <option value={key} key={key}>
                {f.label}
              </option>
            ))}
        </select>
      </label>
      {value && (
        <>
          <p>
            {t(
              "Marca qué opciones se ofrecen para cada respuesta del campo anterior. Al cambiarla, se limpia cualquier selección incompatible.",
            )}
          </p>
          {(fields[value.field]?.options ?? []).map((parent: any) => (
            <fieldset key={parent.value}>
              <legend>
                {t("Cuando")} {fields[value.field].label} {t("es")}{" "}
                {parent.label}
              </legend>
              {(field.options ?? [])
                .filter((o: any) => o.value !== "")
                .map((option: any) => (
                  <label className="dependent-option-check" key={option.value}>
                    <input
                      type="checkbox"
                      checked={
                        value.cases[String(parent.value)]?.includes(
                          String(option.value),
                        ) ?? false
                      }
                      onChange={(e) => {
                        const current = value.cases[String(parent.value)] ?? [];
                        onChange({
                          ...value,
                          cases: {
                            ...value.cases,
                            [String(parent.value)]: e.target.checked
                              ? [...current, String(option.value)]
                              : current.filter(
                                  (v) => v !== String(option.value),
                                ),
                          },
                        });
                      }}
                    />
                    {option.label}
                  </label>
                ))}
            </fieldset>
          ))}
        </>
      )}
    </fieldset>
  );
}
