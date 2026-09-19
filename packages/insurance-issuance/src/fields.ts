import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  { value: "requested", label: "Solicitada" },
  { value: "underwriting", label: "En estudio" },
  { value: "issued", label: "Expedida" },
  { value: "delivered", label: "Entregada" },
  { value: "cancelled", label: "Cancelada" },
];
export const closedStages = ["delivered", "cancelled"];
export const dateField = "due_date";
export const fields = [
  {
    key: "name",
    label: "Referencia",
    required: true,
    maxLength: 120,
  },
  {
    key: "customer",
    label: "Cliente",
    required: true,
  },
  {
    key: "policy_reference",
    label: "Póliza expedida",
    maxLength: 120,
    requiredStages: ["issued", "delivered"],
    help: "Referencia asignada por la aseguradora al expedir la póliza.",
  },
  {
    key: "insurer",
    label: "Aseguradora",
  },
  {
    key: "owner",
    label: "Responsable",
    required: true,
    maxLength: 120,
  },
  {
    key: "product",
    label: "Producto",
    maxLength: 120,
  },
  {
    key: "requested_date",
    label: "Fecha de solicitud",
    type: "date",
    required: true,
  },
  {
    key: "due_date",
    label: "Compromiso de entrega",
    type: "date",
    required: true,
    help: "Fecha acordada con el cliente; no modifica la vigencia de cobertura.",
  },
  {
    key: "effective_date",
    label: "Inicio de vigencia",
    type: "date",
    required: true,
  },
  {
    key: "end_date",
    label: "Fin de vigencia",
    type: "date",
    required: true,
  },
  {
    key: "premium",
    label: "Prima (COP)",
    type: "number",
    required: true,
    min: 0.01,
  },
  {
    key: "issued_date",
    label: "Fecha de expedición",
    type: "date",
    requiredStages: ["issued", "delivered"],
  },
  {
    key: "delivered_date",
    label: "Fecha de entrega",
    type: "date",
    requiredStages: ["delivered"],
  },
  {
    key: "outcome",
    label: "Motivo de cancelación",
    requiredStages: ["cancelled"],
    maxLength: 500,
  },
  {
    key: "stage",
    label: "Etapa",
    type: "select",
    required: true,
    options: [
      {
        value: "requested",
        label: "Solicitada",
      },
      {
        value: "underwriting",
        label: "En estudio",
      },
      {
        value: "issued",
        label: "Expedida",
      },
      {
        value: "delivered",
        label: "Entregada",
      },
      {
        value: "cancelled",
        label: "Cancelada",
      },
    ],
  },
  {
    key: "notes",
    label: "Notas de gestión",
    type: "textarea",
  },
] satisfies Field[];
