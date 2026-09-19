import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  {
    value: "scheduled",
    label: "Programada",
  },
  {
    value: "in_progress",
    label: "En curso",
  },
  {
    value: "completed",
    label: "Realizada",
  },
  {
    value: "cancelled",
    label: "Cancelada",
  },
];
export const closedStages = ["completed", "cancelled"];
export const dateField = "due_date";
export const fields = [
  {
    key: "name",
    label: "Actividad",
    maxLength: 120,
    required: true,
  },
  {
    key: "customer",
    label: "Cliente o prospecto",
  },
  {
    key: "policy_reference",
    label: "Póliza o caso relacionado",
    maxLength: 120,
  },
  {
    key: "owner",
    label: "Responsable",
    maxLength: 120,
    required: true,
  },
  {
    key: "kind",
    label: "Tipo de actividad",
    options: [
      {
        value: "call",
        label: "Llamada",
      },
      {
        value: "meeting",
        label: "Reunión",
      },
      {
        value: "task",
        label: "Tarea",
      },
      {
        value: "review",
        label: "Revisión documental",
      },
    ],
    type: "select",
    required: true,
  },
  {
    key: "due_date",
    label: "Fecha de compromiso",
    type: "date",
    required: true,
  },
  {
    key: "importance",
    label: "Prioridad",
    options: [
      {
        value: "normal",
        label: "Normal",
      },
      {
        value: "high",
        label: "Alta",
      },
      {
        value: "urgent",
        label: "Urgente",
      },
    ],
    type: "select",
    required: true,
  },
  {
    key: "outcome",
    label: "Resultado o motivo de cancelación",
    requiredStages: ["completed", "cancelled"],
    maxLength: 500,
  },
  {
    key: "stage",
    label: "Etapa",
    options: [
      {
        value: "scheduled",
        label: "Programada",
      },
      {
        value: "in_progress",
        label: "En curso",
      },
      {
        value: "completed",
        label: "Realizada",
      },
      {
        value: "cancelled",
        label: "Cancelada",
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
