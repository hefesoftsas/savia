import React, { useState } from "react";
import type { CrmObject } from "@savia/crm-shared/metadata";
import { Input } from "@/components/ui/input";

export function FormLabelsEditor({
  fields,
  onChange,
}: {
  fields: CrmObject["config"]["fields"];
  onChange: (fields: CrmObject["config"]["fields"]) => void;
}) {
  const [search, setSearch] = useState("");
  // Filter by persisted field key as well as label so technical names remain discoverable.
  const entries = Object.entries(fields).filter(([key, field]) =>
    `${key} ${field.label}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <section className="grid gap-3" aria-label="Etiquetas del formulario">
      <div>
        <h3>Etiquetas del formulario</h3>
        <p className="text-sm text-muted-foreground">
          Cambia el nombre visible de cualquier campo, incluidos los
          interruptores y los campos de solo lectura.
        </p>
      </div>
      <Input
        aria-label="Buscar etiqueta"
        placeholder="Buscar por nombre o campo…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid max-h-80 gap-3 overflow-y-auto rounded-md border p-3">
        {entries.map(([key, field]) => (
          <label
            key={key}
            className="grid gap-1 text-sm"
            htmlFor={`form-label-${key}`}
          >
            <span className="text-muted-foreground">{key}</span>
            <Input
              id={`form-label-${key}`}
              aria-label={`Etiqueta de ${key}`}
              maxLength={100}
              value={field.label}
              onChange={(event) =>
                onChange({
                  ...fields,
                  [key]: { ...field, label: event.target.value },
                })
              }
            />
          </label>
        ))}
        {!entries.length && (
          <p className="text-sm text-muted-foreground">
            No se encontraron campos.
          </p>
        )}
      </div>
    </section>
  );
}
