import { objectRequirement } from "@savia/insurance-workbench/schema";
import { manifest } from "./manifest";
export const requirement = objectRequirement(
  manifest,
  "insurance_document_generation",
  [
    { key: "name", label: "Nombre", required: true, maxLength: 160 },
    {
      key: "template",
      label: "Contenido",
      required: true,
      type: "textarea",
      maxLength: 10000,
    },
    {
      key: "kind",
      label: "Tipo",
      type: "select",
      required: true,
      options: [
        { value: "template", label: "Plantilla" },
        { value: "document", label: "Documento" },
      ],
    },
    {
      key: "stage",
      label: "Estado",
      type: "select",
      options: [
        { value: "draft", label: "Borrador" },
        { value: "generated", label: "Generado" },
        { value: "requested", label: "Firma solicitada" },
        { value: "signed", label: "Evidencia recibida" },
      ],
    },
    {
      key: "signature_recipient",
      label: "Correo del firmante",
      maxLength: 320,
    },
    {
      key: "signature_reference",
      label: "Referencia de firma",
      maxLength: 200,
    },
    { key: "artifact_file_id", label: "Archivo generado", maxLength: 200 },
    {
      key: "artifact_file_version",
      label: "Versión del archivo generado",
      type: "number",
      min: 1,
    },
    { key: "signed_at", label: "Fecha de firma", maxLength: 100 },
    { key: "evidence_url", label: "Evidencia de firma", maxLength: 2000 },
  ],
);
