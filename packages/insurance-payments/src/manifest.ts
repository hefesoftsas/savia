import type {
  ExtensionManifest,
  TrustedExtension,
} from "@savia/crm-shared/extension-package";
import { stateSchema, defaults } from "./domain";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.payments",
  version: "1.0.0",
  label: "Conciliación bancaria",
  description: "Importa extractos y asigna recaudos a obligaciones.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: {
    settings: { extensionId: manifest.id, schema: stateSchema, defaults },
  },
} satisfies TrustedExtension;
