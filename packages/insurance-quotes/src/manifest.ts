import { z } from "zod";
import type {
  ExtensionManifest,
  TrustedExtension,
} from "@savia/studio-shared/extension-package";
import {
  insuranceQuotesActionId,
  insuranceQuotesConnectorId,
  insuranceQuotesExtensionId,
} from "./connectors";
import { insuranceQuoteSettingsDefinition } from "./configuration";

export const insuranceQuotesExtensionManifest: ExtensionManifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: insuranceQuotesExtensionId,
  version: "1.2.0",
  label: "Cotizaciones de seguros",
  description: "Conecta proveedores de seguros para solicitar cotizaciones.",
  labels: {"en": "Insurance quotes", "pt": "Cotações de seguros"},
  descriptions: {"en": "Connect insurance providers to request quotes.", "pt": "Conecte provedores de seguros para solicitar cotações."},
  requires: [],
  apiVersion: 1,
};

export const insuranceQuotesExtension = {
  manifest: insuranceQuotesExtensionManifest,
  runtime: {
    settings: insuranceQuoteSettingsDefinition,
    connectors: [
      {
        extensionId: insuranceQuotesExtensionId,
        connectorId: insuranceQuotesConnectorId,
        label: "Proveedor de seguros",
        configurationSchema: z
          .object({
            provider: z.string().trim().min(1),
            credentials: z.record(z.string(), z.unknown()),
          })
          .strict(),
        secretFields: ["credentials"],
      },
    ],
    actions: [
      {
        extensionId: insuranceQuotesExtensionId,
        actionId: insuranceQuotesActionId,
        connectorId: insuranceQuotesConnectorId,
        inputSchema: z.record(z.string(), z.unknown()),
        connectionOptional: true,
      },
    ],
  },
} satisfies TrustedExtension;
