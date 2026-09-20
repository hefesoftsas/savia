import type { FieldLabels } from "@savia/crm-shared/field-labels";

declare module "@form-eng/core" {
  interface IOption {
    labels?: FieldLabels | null;
  }
  interface IFieldConfig {
    labels?: FieldLabels | null;
  }
}
