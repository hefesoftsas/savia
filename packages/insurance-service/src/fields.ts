import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  { value: "received", label: "Recibida" },
  { value: "in_progress", label: "En gestión" },
  { value: "waiting", label: "Esperando información" },
  { value: "resolved", label: "Resuelta" },
  { value: "cancelled", label: "Cancelada" },
];
export const closedStages = ["resolved", "cancelled"];
export const dateField = "due_date";
export const fields = [
  { key: "escalation_date", label: "Fecha de escalamiento", type: "date" },
  {
    key: "escalation_owner",
    label: "Responsable de escalamiento",
    maxLength: 120,
  },
  { key: "escalated_date", label: "Escalada el", type: "date" },
  { key: "response_date", label: "Respuesta enviada el", type: "date" },

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
    label: "Póliza o caso relacionado",
    maxLength: 120,
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
    key: "kind",
    label: "Tipo de solicitud",
    type: "select",
    required: true,
    options: [
      {
        value: "query",
        label: "Consulta",
      },
      {
        value: "complaint",
        label: "Reclamo de servicio",
      },
      {
        value: "certificate",
        label: "Solicitud de certificado",
      },
      {
        value: "data_update",
        label: "Actualización de datos",
      },
      {
        value: "other",
        label: "Otra",
      },
    ],
  },
  {
    key: "channel",
    label: "Canal de recepción",
    type: "select",
    required: true,
    options: [
      {
        value: "email",
        label: "Correo",
      },
      {
        value: "phone",
        label: "Teléfono",
      },
      {
        value: "portal",
        label: "Portal",
      },
      {
        value: "in_person",
        label: "Presencial",
      },
    ],
  },
  {
    key: "received_date",
    label: "Fecha de recepción",
    type: "date",
    required: true,
  },
  {
    key: "due_date",
    label: "Compromiso de respuesta",
    type: "date",
    required: true,
    help: "Fecha operativa acordada; no calcula plazos legales.",
  },
  {
    key: "resolved_date",
    label: "Fecha de resolución",
    type: "date",
    requiredStages: ["resolved"],
  },
  {
    key: "outcome",
    label: "Respuesta o motivo de cancelación",
    type: "textarea",
    requiredStages: ["resolved", "cancelled"],
    maxLength: 4000,
  },
  {
    key: "stage",
    label: "Etapa",
    type: "select",
    required: true,
    options: [
      {
        value: "received",
        label: "Recibida",
      },
      {
        value: "in_progress",
        label: "En gestión",
      },
      {
        value: "waiting",
        label: "Esperando información",
      },
      {
        value: "resolved",
        label: "Resuelta",
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
