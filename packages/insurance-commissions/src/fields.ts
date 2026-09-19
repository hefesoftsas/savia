import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  {
    value: "pending",
    label: "Por conciliar",
  },
  {
    value: "confirmed",
    label: "Confirmada",
  },
  {
    value: "disputed",
    label: "Diferencia por revisar",
  },
];
export const closedStages = [];
export const dateField = "due_date";
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
    key: "premium",
    label: "Prima base (COP)",
    min: 0,
    type: "number",
  },
  {
    key: "rate",
    label: "Tasa de comisión (%)",
    min: 0,
    max: 100,
    type: "number",
  },
  {
    key: "amount",
    label: "Comisión esperada (COP)",
    min: 0.01,
    type: "number",
    required: true,
  },
  {
    key: "paid",
    label: "Comisión recibida (COP)",
    min: 0,
    type: "number",
    required: true,
  },
  {
    key: "seller_share",
    label: "Participación del vendedor (COP)",
    min: 0,
    type: "number",
    required: true,
  },
  {
    key: "due_date",
    label: "Fecha prevista de recaudo",
    type: "date",
    required: true,
  },
  {
    key: "last_payment_date",
    label: "Último recaudo",
    type: "date",
  },
  {
    key: "next_follow_up",
    label: "Próximo seguimiento",
    type: "date",
  },
  {
    key: "stage",
    label: "Etapa",
    options: [
      {
        value: "pending",
        label: "Por conciliar",
      },
      {
        value: "confirmed",
        label: "Confirmada",
      },
      {
        value: "disputed",
        label: "Diferencia por revisar",
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
