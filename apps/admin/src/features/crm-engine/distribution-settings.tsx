import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import type { RequestPageConfig } from "@savia/crm-shared/request-page";
import type { WizardConfig } from "@savia/crm-shared/metadata";
import type { Condition } from "@savia/crm-shared/rules";
import { FormColumnPicker } from "./form-layout-picker";
import { FormSectionsEditor } from "./form-sections-editor";

export type StudioLayout = {
  requestPage?: RequestPageConfig;
  wizard?: WizardConfig;
  columns: 1 | 2 | 3;
  sections: { id: string; label: string; visibleWhen?: Condition }[];
  pipeline?: {
    field: string;
    amountField?: string;
    ownerField?: string;
    wonValues?: string[];
    lostValues?: string[];
  };
};

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="studio-control">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Choice({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

export function DistributionSettings({
  studio,
  setStudio,
  fields,
  fieldOrder,
  onClearSection,
}: {
  studio: StudioLayout;
  setStudio: (studio: StudioLayout) => void;
  fields: Record<string, { type: string; label: string; config?: Record<string, unknown> }>;
  fieldOrder: string[];
  onClearSection: (sectionId: string) => void;
}) {
  const fieldCountsBySectionId = Object.fromEntries(
    studio.sections.map((section) => [
      section.id,
      fieldOrder.filter(
        (name) => fields[name]?.config?.section === section.id,
      ).length,
    ]),
  );

  return (
    <div className="studio-distribution-settings">
      <fieldset className="studio-form-columns">
        <legend>Columnas del formulario</legend>
        <FormColumnPicker
          name="studio-form-columns"
          value={studio.columns}
          onChange={(columns) => setStudio({ ...studio, columns })}
        />
      </fieldset>
      <FormSectionsEditor
        sections={studio.sections}
        fieldCountsBySectionId={fieldCountsBySectionId}
        fields={fields}
        onChange={(sections) => setStudio({ ...studio, sections })}
        onClearSection={onClearSection}
      />
      <details className="studio-settings-nested">
        <summary>Pipeline CRM (opcional)</summary>
        <div className="studio-two">
          <Control label="Campo de etapa del pipeline">
            <Choice
              value={studio.pipeline?.field ?? ""}
              label="Campo de etapa del pipeline"
              onChange={(field) =>
                setStudio({
                  ...studio,
                  pipeline: field ? { ...studio.pipeline, field } : undefined,
                })
              }
            >
              <option value="">Sin pipeline</option>
              {fieldOrder
                .filter(
                  (n) =>
                    fields[n]?.type === "Dropdown" &&
                    !fields[n]?.config?.relation,
                )
                .map((n) => (
                  <option key={n} value={n}>
                    {fields[n].label}
                  </option>
                ))}
            </Choice>
          </Control>
        </div>
        {studio.pipeline && (
          <div className="studio-two">
            <Control label="Campo de importe">
              <Choice
                value={studio.pipeline.amountField ?? ""}
                label="Campo de importe"
                onChange={(amountField) =>
                  setStudio({
                    ...studio,
                    pipeline: {
                      ...studio.pipeline!,
                      amountField: amountField || undefined,
                    },
                  })
                }
              >
                <option value="">Sin importe</option>
                {fieldOrder
                  .filter((n) => fields[n]?.type === "Number")
                  .map((n) => (
                    <option key={n} value={n}>
                      {fields[n].label}
                    </option>
                  ))}
              </Choice>
            </Control>
            <Control label="Campo de responsable">
              <Choice
                value={studio.pipeline.ownerField ?? ""}
                label="Campo de responsable"
                onChange={(ownerField) =>
                  setStudio({
                    ...studio,
                    pipeline: {
                      ...studio.pipeline!,
                      ownerField: ownerField || undefined,
                    },
                  })
                }
              >
                <option value="">Sin responsable</option>
                {fieldOrder.map((n) => (
                  <option key={n} value={n}>
                    {fields[n].label}
                  </option>
                ))}
              </Choice>
            </Control>
            <Control label="Etapas ganadas (separadas por coma)">
              <Input
                value={studio.pipeline.wonValues?.join(",") ?? ""}
                onChange={(e) =>
                  setStudio({
                    ...studio,
                    pipeline: {
                      ...studio.pipeline!,
                      wonValues: e.target.value.split(",").filter(Boolean),
                    },
                  })
                }
              />
            </Control>
            <Control label="Etapas perdidas (separadas por coma)">
              <Input
                value={studio.pipeline.lostValues?.join(",") ?? ""}
                onChange={(e) =>
                  setStudio({
                    ...studio,
                    pipeline: {
                      ...studio.pipeline!,
                      lostValues: e.target.value.split(",").filter(Boolean),
                    },
                  })
                }
              />
            </Control>
          </div>
        )}
      </details>
    </div>
  );
}
