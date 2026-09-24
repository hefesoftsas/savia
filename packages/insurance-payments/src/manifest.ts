import type {
  ExtensionManifest,
  TrustedExtension,
} from "@savia/studio-shared/extension-package";
import { stateSchema, defaults } from "./domain";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.payments",
  version: "1.0.0",
  label: "Conciliación bancaria",
  description: "Importa extractos y asigna recaudos a obligaciones.",
  labels: {"en": "Bank reconciliation", "pt": "Conciliação bancária"},
  descriptions: {"en": "Import statements and allocate receipts to obligations.", "pt": "Importe extratos e aloque recebimentos a obrigações."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: {
    settings: { extensionId: manifest.id, schema: stateSchema, defaults },
  },
} satisfies TrustedExtension;
