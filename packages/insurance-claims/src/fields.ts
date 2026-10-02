import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  {
    value: "reported",
    label: "Reportado",
  },
  {
    value: "documents",
    label: "Documentación",
  },
  {
    value: "assessment",
    label: "En evaluación",
  },
  {
    value: "approved",
    label: "Aprobado",
  },
  {
    value: "closed",
    label: "Cerrado",
  },
  {
    value: "rejected",
    label: "Rechazado",
  },
];
export const closedStages = ["closed", "rejected"];
export const dateField = "next_follow_up";
export const fields = [
  {
    key: "name", lookup: true,
    label: "Referencia",
    maxLength: 120,
    required: true,
  },
  {
    key: "customer", lookup: true,
    label: "Cliente",
    required: true,
  },
  {
    key: "policy_reference", lookup: true,
    label: "Póliza",
    maxLength: 120,
    required: true,
  },
  {
    key: "insurer", lookup: true,
    label: "Aseguradora",
  },
  {
    key: "owner", lookup: true,
    label: "Responsable",
    maxLength: 120,
  },
  {
    key: "incident_date",
    label: "Fecha del siniestro",
    type: "date",
    required: true,
  },
  {
    key: "notified_date",
    label: "Aviso a la aseguradora",
    type: "date",
  },
  {
    key: "insurer_reference", lookup: true,
    label: "Radicado de la aseguradora",
    maxLength: 120,
  },
  {
    key: "adjuster", lookup: true,
    label: "Ajustador",
  },
  {
    key: "amount",
    label: "Valor reclamado (COP)",
    min: 0,
    type: "number",
    required: true,
  },
  {
    key: "paid",
    label: "Indemnización recibida (COP)",
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
    key: "outcome", lookup: true,
    label: "Resultado del caso",
    requiredStages: ["closed", "rejected"],
    maxLength: 500,
    help: "Describe la resolución o el motivo de rechazo al cerrar el caso.",
  },
  {
    key: "stage",
    label: "Etapa",
    options: [
      {
        value: "reported",
        label: "Reportado",
      },
      {
        value: "documents",
        label: "Documentación",
      },
      {
        value: "assessment",
        label: "En evaluación",
      },
      {
        value: "approved",
        label: "Aprobado",
      },
      {
        value: "closed",
        label: "Cerrado",
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
