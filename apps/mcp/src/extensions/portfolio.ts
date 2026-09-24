import type { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { z } from "zod";
import { summarizeInsurancePortfolio } from "@savia/insurance-portfolio-dashboard/summary";
import type { SaviaApiClient } from "../savia-api";

const PORTFOLIO_EXTENSION_ID = "insurance.portfolio-dashboard";
const POLICIES_COLLECTION = "polizas";
const SUMMARY_PER_PAGE = 200;
const SUMMARY_MAX_PAGES = 20;

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
        summary: summarizeInsurancePortfolio(records, new Date().toISOString()),
      };
    },
  );
}
