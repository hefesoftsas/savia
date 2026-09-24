import type { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import type { SaviaApiClient } from "../savia-api";

const PORTFOLIO_EXTENSION_ID = "insurance.portfolio-dashboard";
const POLICIES_COLLECTION = "polizas";
const SUMMARY_PER_PAGE = 200;
const SUMMARY_MAX_PAGES = 20;

// Agregación local del resumen (misma definición que el reductor puro
// del paquete de cartera): el worker no puede importar implementaciones
// del sector (insurance-boundary), así que la computa sobre las
// colecciones del tenant. Cubierto por el test del tool con registros
// fijos.
const statusFields = ["estado", "status", "estado_poliza", "policyStatus"];
const expirationFields = [
  "fecha_vencimiento",
  "fechaVencimiento",
  "vencimiento",
  "fin",
  "expirationDate",
  "expiresAt",
];
const premiumFields = ["prima", "premium", "valor_prima", "valorPrima"];
const activeStatuses = new Set([
  "vigente",
  "activa",
  "activo",
  "active",
  "in_force",
  "in-force",
  "en_vigor",
]);

function first(
  record: Record<string, unknown>,
  fields: readonly string[],
): unknown {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function asNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizePolicies(
  policies: readonly Record<string, unknown>[],
  asOf: string,
) {
  const reference = new Date(asOf).getTime();
  let active = 0;
  let expiring = 0;
  let premiumTotal = 0;
  let hasPremium = false;
  const thirtyDaysLater = reference + 30 * 24 * 60 * 60 * 1000;
  for (const policy of policies) {
    const status = first(policy, statusFields);
    if (
      typeof status !== "string" ||
      !activeStatuses.has(status.trim().toLocaleLowerCase("es-CO"))
    )
      continue;
    active += 1;
    const expiration = first(policy, expirationFields);
    const expiresAt =
      typeof expiration === "string" || typeof expiration === "number"
        ? new Date(expiration).getTime()
        : NaN;
    if (
      Number.isFinite(expiresAt) &&
      expiresAt >= reference &&
      expiresAt <= thirtyDaysLater
    )
      expiring += 1;
    const policyPremium = asNumber(first(policy, premiumFields));
    if (policyPremium !== null) {
      premiumTotal += policyPremium;
      hasPremium = true;
    }
  }
  return {
    total: policies.length,
    active,
    expiring,
    premiumTotal: hasPremium ? premiumTotal : null,
    asOf,
  };
}

type PolicyPage = {
  data: Record<string, unknown>[];
  total: number;
};

/**
 * Resumen de cartera calculado con las colecciones del tenant y el
 * reductor puro del paquete: no depende del proveedor de resúmenes
 * compilado, así el plugin puede salir del release.
 */
export function registerPortfolioAssistantTool(
  server: FastMCP,
  clientForRequest: () => SaviaApiClient,
): void {
  server.tool(
    {
      name: "savia_extension_insurance_portfolio",
      annotations: { readOnlyHint: true },
      description:
        "Read the authorized tenant's portfolio of policies, active coverage, upcoming expirations, and total premium. This tool never changes policy data.",
      input: z.object({}),
    },
    async () => {
      const client = clientForRequest();
      const extension = await client.extensionStatus(PORTFOLIO_EXTENSION_ID);
      if (!extension.builtIn && !extension.installed?.enabled) {
        throw new Error(
          "The insurance.portfolio-dashboard extension is not active for this tenant",
        );
      }
      const records: Record<string, unknown>[] = [];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;
      while (records.length < total && page <= SUMMARY_MAX_PAGES) {
        const result = (await client.listStudioRecords(POLICIES_COLLECTION, {
          page,
          perPage: SUMMARY_PER_PAGE,
        })) as Partial<PolicyPage>;
        total =
          typeof result.total === "number" ? result.total : records.length;
        if (Array.isArray(result.data)) records.push(...result.data);
        if (!Array.isArray(result.data) || result.data.length === 0) break;
        page += 1;
      }
      return {
        extension: PORTFOLIO_EXTENSION_ID,
        summary: summarizePolicies(records, new Date().toISOString()),
      };
    },
  );
}
