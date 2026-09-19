import { z } from "zod";
import type {
  TrustedExtension,
  ExtensionManifest,
} from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.compliance",
  version: "1.0.0",
  label: "Expedientes de cumplimiento",
  description:
    "Organiza requisitos, evidencias, revisiones y vigencias configurables.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;

export const settingsSchema = z
  .object({
    template: z
      .object({
        name: z.string().trim().min(1).max(120),
        requirements: z
          .array(z.string().trim().min(1).max(160))
          .min(1)
          .max(50)
          .refine(
            (rows) => new Set(rows).size === rows.length,
            "Requirements must be distinct",
          ),
      })
      .optional(),
  })
  .strict();
export const extension = {
  manifest,
  runtime: {
    settings: {
      extensionId: manifest.id,
      schema: settingsSchema,
      defaults: {},
    },
  },
} satisfies TrustedExtension;
