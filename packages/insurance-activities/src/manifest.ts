import type { ExtensionManifest } from "@savia/studio-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.activities",
  version: "1.0.0",
  label: "Actividades",
  description: "Agenda operativa, responsables y seguimiento de compromisos.",
  labels: {"en": "Activities", "pt": "Atividades"},
  descriptions: {"en": "Operational agenda, owners and commitment tracking.", "pt": "Agenda operacional, responsáveis e acompanhamento de compromissos."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
