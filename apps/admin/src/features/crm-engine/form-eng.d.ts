import type { FieldLabels } from "@savia/crm-shared/field-labels";

declare module "@form-eng/core" {
  interface IFieldConfig {
    labels?: FieldLabels | null;
  }
}
