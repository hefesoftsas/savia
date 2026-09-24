import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  InsurancePackageAdminScreen,
  InsuranceQuoteWizardScreen,
  InsuranceQuoteWorkspaceScreen,
} from "../../packages/insurance-quotes/src/screens/quote-screens";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import { quoteTabForScreen, type QuoteTab } from "./entry-selection";

const TABS = [
  {
    id: "direct",
    label: "Directa",
    Screen: InsuranceQuoteWorkspaceScreen,
  },
  {
    id: "wizard",
    label: "Por pasos",
    Screen: InsuranceQuoteWizardScreen,
  },
  {
    id: "admin",
    label: "Administrar",
    Screen: InsurancePackageAdminScreen,
  },
] as const;

function Shell({
  savia,
  initialTab,
}: {
  savia: PluginApi;
  initialTab: QuoteTab;
}) {
  const [tab, setTab] = useState<QuoteTab>(initialTab);
  const Active = TABS.find((t) => t.id === tab)!.Screen;
  return (
    <div>
      <nav aria-label="Cotizador">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <Active savia={savia} />
    </div>
  );
}

/**
 * Adaptador del store: las 3 pantallas del cotizador con ejecución
 * nativa savia-request del host (sin delegación al release).
 */
export function render(
  el: HTMLElement,
  savia: PluginApi,
  screen?: { object: string; view: string },
) {
  createRoot(el).render(
    <Shell savia={savia} initialTab={quoteTabForScreen(screen?.object)} />,
  );
}
