import { useEffect, useMemo, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { CrmObject } from "@savia/crm-shared/metadata";

export function useFormTemplateValues(
  object?: CrmObject,
  excludeField?: string,
) {
  const { control, subscribe, getValues } = useFormContext();
  const names = useMemo(
    () =>
      Object.keys(object?.config.fields ?? {}).filter(
        (name) => name !== excludeField,
      ),
    [excludeField, object?.config.fields],
  );
  const watched = useWatch({ control, name: names });
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    getValues(),
  );

  useEffect(() => {
    return subscribe({
      formState: { values: true },
      callback: ({ values: next }) => {
        setValues(next ?? getValues());
      },
    });
  }, [getValues, subscribe]);

  return useMemo(() => {
    const fromWatch: Record<string, unknown> = {};
    const entries = Array.isArray(watched) ? watched : [watched];
    for (const [index, name] of names.entries()) {
      fromWatch[name] = entries[index];
    }
    return { ...values, ...fromWatch };
  }, [names, values, watched]);
}
