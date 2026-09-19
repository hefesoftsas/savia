import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  {
    value: "requested",
    label: "Solicitado",
  },
  {
    value: "review",
    label: "En revisión",
  },
  {
    value: "submitted",
    label: "Enviado a aseguradora",
  },
  {
    value: "issued",
    label: "Expedido",
  },
  {
    value: "rejected",
    label: "Rechazado",
  },
];
export const closedStages = ["issued", "rejected"];
export const dateField = "effective_date";
export const fields = [
  {
    key: "name",
    label: "Referencia",
    maxLength: 120,
    required: true,
  },
  {
    key: "customer",
    label: "Cliente",
    required: true,
  },
  {
    key: "policy_reference",
    label: "Póliza",
    maxLength: 120,
    required: true,
  },
  {
    key: "insurer",
    label: "Aseguradora",
  },
  {
    key: "owner",
    label: "Responsable",
    maxLength: 120,
  },
  {
    key: "kind",
    label: "Tipo de movimiento",
    options: [
      {
        value: "coverage",
        label: "Cambio de cobertura",
      },
      {
        value: "inclusion",
        label: "Inclusión",
      },
      {
        value: "exclusion",
        label: "Exclusión",
      },
      {
        value: "correction",
        label: "Corrección",
      },
      {
        value: "cancellation",
        label: "Cancelación",
      },
    ],
    type: "select",
    required: true,
  },
  {
    key: "requested_date",
    label: "Fecha de solicitud",
    type: "date",
    required: true,
  },
  {
    key: "effective_date",
    label: "Fecha de efecto",
    type: "date",
    required: true,
  },
  {
    key: "additional_premium",
    label: "Prima adicional (COP)",
    min: 0,
    type: "number",
    required: true,
  },
  {
    key: "refund",
    label: "Devolución de prima (COP)",
    min: 0,
    type: "number",
    required: true,
  },
  {
    key: "next_follow_up",
    label: "Próximo seguimiento",
    type: "date",
  },
  {
    key: "outcome",
    label: "Anexo expedido o motivo de rechazo",
    requiredStages: ["issued", "rejected"],
    maxLength: 500,
  },
  {
    key: "stage",
    label: "Etapa",
    options: [
      {
        value: "requested",
        label: "Solicitado",
      },
      {
        value: "review",
        label: "En revisión",
      },
      {
        value: "submitted",
        label: "Enviado a aseguradora",
      },
      {
        value: "issued",
        label: "Expedido",
      },
      {
        value: "rejected",
        label: "Rechazado",
      },
    ],
    type: "select",
    required: true,
  },
  {
    key: "notes",
    label: "Notas de gestión",
    type: "textarea",
  },
] satisfies Field[];
