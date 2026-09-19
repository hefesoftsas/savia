import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  { value: "pending", label: "Pendiente" },
  { value: "review", label: "En revisión" },
  { value: "approved", label: "Aprobado" },
  { value: "changes", label: "Requiere ajustes" },
  { value: "waived", label: "Exento" },
];
export const fields: Field[] = [
  { key: "name", label: "Requisito", required: true, maxLength: 160 },
  { key: "customer", label: "Cliente", required: true },
  { key: "owner", label: "Responsable", required: true, maxLength: 120 },
  {
    key: "due_date",
    label: "Compromiso de revisión",
    type: "date",
    required: true,
  },
  {
    key: "stage",
    label: "Estado",
    type: "select",
    options: stages,
    required: true,
  },
  {
    key: "evidence",
    label: "Referencia de evidencia",
    requiredStages: ["approved"],
    maxLength: 500,
    help: "Adjunta el soporte en Archivos y registra su referencia para revisar el requisito.",
  },
  {
    key: "reviewed_date",
    label: "Fecha de revisión",
    type: "date",
    requiredStages: ["approved", "waived"],
  },
  { key: "valid_until", label: "Válido hasta", type: "date" },
  {
    key: "outcome",
    label: "Resultado o motivo de exención",
    type: "textarea",
    requiredStages: ["waived", "changes"],
    maxLength: 2000,
  },
  {
    key: "details",
    label: "Instrucciones y notas",
    type: "textarea",
    maxLength: 10000,
  },
];
