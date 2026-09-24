import { createRoot } from "react-dom/client";
import { InsurancePortfolioPoliciesScreen } from "../../packages/insurance-portfolio-dashboard/src/screens/policies";
import { InsurancePortfolioSummaryWidget } from "../../packages/insurance-portfolio-dashboard/src/widgets";
import { summarizeInsurancePortfolio } from "../../packages/insurance-portfolio-dashboard/src/summary";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import type { MyDayWidget } from "../../packages/studio-shared/src/my-day-widgets";

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

function scoped(savia: PluginApi): PluginApi {
  return {
    ...savia,
    services: {
      get: async (name: string) => {
        if (name !== "summary")
          throw new Error(`Servicio no disponible en el store: ${name}.`);
        return clientSummary(savia) as never;
      },
    },
  };
}

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(
    <InsurancePortfolioPoliciesScreen savia={scoped(savia)} />,
  );
}

export const widgets = {
  summary: (el: HTMLElement, savia: PluginApi, widget: MyDayWidget) => {
    createRoot(el).render(
      <InsurancePortfolioSummaryWidget savia={scoped(savia)} widget={widget} />,
    );
  },
};
