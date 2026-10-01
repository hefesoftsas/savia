import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  {
    value: "lead",
    label: "Prospecto",
  },
  {
    value: "qualified",
    label: "Calificada",
  },
  {
    value: "proposal",
    label: "Propuesta enviada",
  },
  {
    value: "negotiation",
    label: "En negociación",
  },
  {
    value: "won",
    label: "Ganada",
  },
  {
    value: "lost",
    label: "Perdida",
  },
];
export const closedStages = ["won", "lost"];
export const dateField = "target_date";
export const fields = [
  {
    key: "name", lookup: true,
    label: "Oportunidad",
    maxLength: 120,
    required: true,
  },
  {
    key: "customer", lookup: true,
    label: "Cliente o prospecto",
    required: true,
  },
  {
    key: "policy_reference", lookup: true,
    label: "Póliza relacionada",
    maxLength: 120,
  },
  {
    key: "owner", lookup: true,
    label: "Responsable",
    maxLength: 120,
    required: true,
  },
  {
    key: "product", lookup: true,
    label: "Ramo o producto",
  },
  {
    key: "source",
    label: "Origen",
    options: [
      {
        value: "referral",
        label: "Referido",
      },
      {
        value: "inbound",
        label: "Consulta entrante",
      },
      {
        value: "outbound",
        label: "Prospección",
      },
      {
        value: "existing",
        label: "Cliente actual",
      },
    ],
    type: "select",
  },
  {
    key: "target_date",
    label: "Fecha esperada de cierre",
    type: "date",
    required: true,
  },
  {
    key: "premium",
    label: "Prima estimada (COP)",
    min: 0,
    type: "number",
    required: true,
  },
  {
    key: "probability",
    label: "Probabilidad (%)",
    min: 0,
    max: 100,
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
    label: "Póliza ganada o motivo de pérdida",
    requiredStages: ["won", "lost"],
    maxLength: 500,
  },
  {
    key: "stage",
    label: "Etapa",
    options: [
      {
        value: "lead",
        label: "Prospecto",
      },
      {
        value: "qualified",
        label: "Calificada",
      },
      {
        value: "proposal",
        label: "Propuesta enviada",
      },
      {
        value: "negotiation",
        label: "En negociación",
      },
      {
        value: "won",
        label: "Ganada",
      },
      {
        value: "lost",
        label: "Perdida",
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
