import { z } from "zod";
import type { ExtensionSettingsDefinition } from "@savia/crm-shared/extension-runtime";
import { defaultClientMapping } from "./client-mapping";
import { insuranceQuotesExtensionId } from "./connectors";
import {
  insuranceLookupFlowCatalog,
  insuranceQuoteFlowCatalog,
} from "./savia-request-bundle";

export const insuranceQuoteProductCatalog = insuranceQuoteFlowCatalog.map(
  (flow) => ({
    id: flow.id,
    label: flow.label,
    flowId: flow.id,
    operationId: flow.id,
  }),
);

export type InsuranceQuoteProductId = (typeof insuranceQuoteProductCatalog)[number]["id"];

const productIdSchema = z.enum([
  "sbs-producto-8",
  "sbs-producto-10",
  "sbs-producto-11",
  "equidad-basico-quote",
  "equidad-full-quote",
  "equidad-ligero-quote",
  "equidad-rce-quote",
  "liberty-basico-quote",
  "liberty-basico-pt-quote",
  "liberty-full-quote",
  "liberty-integral-quote",
  "mapfre-para-la-mujer-quote",
  "qualitas-direct-research",
  "qualitas-base-quote",
  "qualitas-plus-quote",
  "previsora-clasica-quote",
  "previsora-preferente-quote",
  "previsora-premium-quote",
  "previsora-sin-asistencia-quote",
]);

const productSettingsSchema = z
  .object({
    id: productIdSchema,
    label: z.string().trim().min(1).max(100),
    connectionId: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean(),
    rank: z.number().int().min(0).max(10_000),
  })
  .strict();

const legacyProductSettingsSchema = z
  .object({
    id: z.union([
      productIdSchema,
      z.enum(["sbs-product-8", "sbs-product-10", "sbs-product-11"]),
    ]),
    label: z.string().trim().min(1).max(100),
    connectionId: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean(),
    rank: z.number().int().min(0).max(10_000),
  })
  .strict();

const vehicleLookupFlowIdSchema = z.enum([
  "sura-autos-provider",
  "equidad-vehicle-by-plate",
]);

const vehicleLookupSchema = z
  .object({
    enabled: z.boolean(),
    flowId: vehicleLookupFlowIdSchema,
    connectionId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const clientMappingSchema = z
  .object({
    collection: z.string().trim().min(1).max(100),
    matchField: z.string().trim().min(1).max(100),
    fieldMap: z.record(
      z.string().trim().min(1).max(100),
      z.string().trim().min(1).max(100),
    ),
  })
  .strict();

const legacyClientMappingSchema = clientMappingSchema.optional();

const legacyVehicleLookupSchema = z
  .object({
    enabled: z.boolean(),
    flowId: vehicleLookupFlowIdSchema.optional(),
    connectionId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const insurancePackageSettingsSchema = z
  .object({
    quotePages: z.object({ direct: z.boolean(), wizard: z.boolean() }).strict(),
    vehicleLookup: vehicleLookupSchema,
    clientMapping: clientMappingSchema,
    products: z
      .array(productSettingsSchema)
      .superRefine((products, context) => {
        const ids = new Set<string>();
        for (const [index, product] of products.entries()) {
          if (ids.has(product.id))
            context.addIssue({
              code: "custom",
              message: "Un producto no puede configurarse dos veces.",
              path: [index, "id"],
            });
          ids.add(product.id);
        }
      }),
  })
  .strict();

const legacyInsurancePackageSettingsSchema = z
  .object({
    quotePages: z.object({ direct: z.boolean(), wizard: z.boolean() }).strict(),
    vehicleLookup: legacyVehicleLookupSchema,
    clientMapping: legacyClientMappingSchema,
    products: z.array(legacyProductSettingsSchema),
  })
  .strict();

export type InsurancePackageSettings = z.infer<
  typeof insurancePackageSettingsSchema
>;

export const defaultInsurancePackageSettings: InsurancePackageSettings = {
  quotePages: { direct: true, wizard: true },
  vehicleLookup: {
    enabled: true,
    flowId:
      insuranceLookupFlowCatalog.find((flow) => flow.enabledByDefault)?.id ??
      "sura-autos-provider",
  },
  clientMapping: {
    ...defaultClientMapping,
    fieldMap: { ...defaultClientMapping.fieldMap },
  },
  products: insuranceQuoteProductCatalog.map((product, index) => ({
    id: product.id,
    label: product.label,
    enabled: true,
    rank: (index + 1) * 10,
  })),
};

const legacyProductIdMap: Record<string, string> = {
  "sbs-product-8": "sbs-producto-8",
  "sbs-product-10": "sbs-producto-10",
  "sbs-product-11": "sbs-producto-11",
};

export function mergeInsuranceSettings(
  value: unknown,
): InsurancePackageSettings {
  const stored = legacyInsurancePackageSettingsSchema.parse(value);
  const configured = new Map(
    stored.products.map((product) => [
      legacyProductIdMap[product.id] ?? product.id,
      product,
    ]),
  );
  let nextRank = Math.max(0, ...stored.products.map((product) => product.rank));
  return {
    quotePages: stored.quotePages,
    vehicleLookup: {
      enabled: stored.vehicleLookup.enabled,
      flowId: stored.vehicleLookup.flowId ?? "sura-autos-provider",
    },
    clientMapping: stored.clientMapping ?? {
      ...defaultClientMapping,
      fieldMap: { ...defaultClientMapping.fieldMap },
    },
    products: insuranceQuoteProductCatalog.map((product) => {
      const current = configured.get(product.id);
      if (current)
        return {
          id: product.id,
          label: product.label,
          enabled: current.enabled,
          rank: current.rank,
        };
      nextRank += 10;
      return {
        id: product.id,
        label: product.label,
        enabled: true,
        rank: nextRank,
      };
    }),
  };
}

export const insuranceQuoteSettingsDefinition: ExtensionSettingsDefinition = {
  extensionId: insuranceQuotesExtensionId,
  schema: insurancePackageSettingsSchema,
  defaults: defaultInsurancePackageSettings,
};
