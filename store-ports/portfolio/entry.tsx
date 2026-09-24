import { createRoot } from "react-dom/client";
import { InsurancePortfolioPoliciesScreen } from "../../packages/insurance-portfolio-dashboard/src/screens/policies";
import { summarizeInsurancePortfolio } from "../../packages/insurance-portfolio-dashboard/src/summary";
import type { PluginApi } from "../../packages/crm-shared/src/plugin-api";

const MAX_SUMMARY_PAGES = 50;
const SUMMARY_PER_PAGE = 200;

/**
 * El resumen se calcula en cliente con el mismo reductor puro del
 * release: pagina la colección y agrega localmente. Sin backend.
 */
async function clientSummary(savia: PluginApi, objectName = "polizas") {
  const collection =
    savia.collections.collection<Record<string, unknown>>(objectName);
  const records: Record<string, unknown>[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (records.length < total && page <= MAX_SUMMARY_PAGES) {
    const result = await collection.list({ page, perPage: SUMMARY_PER_PAGE });
    total = result.total;
    records.push(...result.data);
    if (!result.data.length) break;
    page += 1;
  }
  return summarizeInsurancePortfolio(records, new Date().toISOString());
}

export function render(el: HTMLElement, savia: PluginApi) {
  const scoped: PluginApi = {
    ...savia,
    services: {
      get: async (name: string) => {
        if (name !== "summary")
          throw new Error(`Servicio no disponible en el store: ${name}.`);
        return clientSummary(savia) as never;
      },
    },
  };
  createRoot(el).render(<InsurancePortfolioPoliciesScreen savia={scoped} />);
}
