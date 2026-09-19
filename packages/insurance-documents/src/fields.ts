import type { Field } from "@savia/insurance-workbench/types";
export const stages = [
  { value: "requested", label: "Solicitado" },
  { value: "received", label: "Recibido" },
  { value: "changes", label: "Requiere corrección" },
  { value: "approved", label: "Aprobado" },
  { value: "waived", label: "Exento" },
];
export const closedStages = ["approved", "waived"];
export const dateField = "due_date";
export const fields = [
  {
    key: "valid_until",
    label: "Válido hasta",
    type: "date",
    help: "Un documento aprobado vuelve a requerir atención después de esta fecha.",
  },
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
    label: "Tipo de documento",
    type: "select",
    required: true,
    options: [
      {
        value: "application",
        label: "Solicitud firmada",
      },
      {
        value: "identity",
        label: "Identificación",
      },
      {
        value: "inspection",
        label: "Inspección",
      },
      {
        value: "payment",
        label: "Soporte de pago",
      },
      {
        value: "other",
        label: "Otro",
      },
    ],
  },
  {
    key: "requested_date",
    label: "Fecha de solicitud",
    type: "date",
    required: true,
  },
  {
    key: "due_date",
    label: "Fecha de compromiso",
    type: "date",
    required: true,
  },
  {
    key: "received_date",
    label: "Fecha de recepción",
    type: "date",
    requiredStages: ["received", "changes", "approved"],
  },
  {
    key: "evidence_reference",
    label: "Referencia del archivo",
    requiredStages: ["received", "changes", "approved"],
    maxLength: 500,
    help: "Identificador o ubicación del archivo guardado en el gestor documental. Este formulario no carga archivos.",
  },
  {
    key: "reviewed_date",
    label: "Fecha de revisión",
    type: "date",
    requiredStages: ["changes", "approved"],
  },
  {
    key: "outcome",
    label: "Resultado de revisión o motivo de exención",
    requiredStages: ["changes", "approved", "waived"],
    type: "textarea",
    maxLength: 2000,
  },
  {
    key: "stage",
    label: "Etapa",
    type: "select",
    required: true,
    options: [
      {
        value: "requested",
        label: "Solicitado",
      },
      {
        value: "received",
        label: "Recibido",
      },
      {
        value: "changes",
        label: "Requiere corrección",
      },
      {
        value: "approved",
        label: "Aprobado",
      },
      {
        value: "waived",
        label: "Exento",
      },
    ],
  },
  {
    key: "notes",
    label: "Notas de gestión",
    type: "textarea",
  },
] satisfies Field[];
