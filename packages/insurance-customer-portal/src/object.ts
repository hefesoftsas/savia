import { objectRequirement } from "@savia/insurance-workbench/schema";
import { manifest } from "./manifest";
export const requirement = objectRequirement(
  manifest,
  "insurance_customer_portal",
  [
    { key: "name", label: "Asunto", required: true, maxLength: 160 },
    {
      key: "customer_id",
      label: "Identificador del cliente",
      required: true,
      maxLength: 200,
    },
    {
      key: "kind",
      label: "Tipo",
      type: "select",
      required: true,
      options: [
        { value: "query", label: "Consulta" },
        { value: "certificate", label: "Certificado" },
        { value: "data_update", label: "Actualización de datos" },
        { value: "complaint", label: "Reclamo de servicio" },
        { value: "claim", label: "Aviso de siniestro" },
      ],
    },
    { key: "policy_reference", label: "Póliza relacionada", maxLength: 200 },
    {
      key: "details",
      label: "Descripción del cliente",
      type: "textarea",
      required: true,
      maxLength: 6000,
    },
    {
      key: "stage",
      label: "Estado",
      type: "select",
      required: true,
      options: [
        { value: "received", label: "Recibida" },
        { value: "in_progress", label: "En revisión" },
        { value: "waiting", label: "Esperando información" },
        { value: "resolved", label: "Respondida" },
        { value: "cancelled", label: "Cancelada" },
      ],
    },
    {
      key: "response",
      label: "Respuesta al cliente",
      type: "textarea",
      maxLength: 6000,
    },
    { key: "response_date", label: "Fecha de respuesta", type: "date" },
  ],
);
