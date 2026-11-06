import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  InsurancePackageAdminScreen,
  InsuranceQuoteWizardScreen,
} from "../../packages/insurance-quotes/src/screens/quote-screens";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import "./entry.css";

const TABS = [
  {
    id: "wizard",
    label: "Cotizador",
  },
  {
    id: "admin",
    label: "Configurar",
  },
] as const;

type QuoteTab = (typeof TABS)[number]["id"];

function Shell({ savia }: { savia: PluginApi }) {
  const [tab, setTab] = useState<QuoteTab>("wizard");
  return (
    <div className="store-quote">
      <nav className="store-quote__tabs" aria-label="Cotizador">
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
      {tab === "admin" ? (
        <InsurancePackageAdminScreen savia={savia} showScreenToggles={false} />
      ) : (
        <InsuranceQuoteWizardScreen savia={savia} />
      )}
    </div>
  );
}

/**
 * Store adapter for the quote wizard and its inline configuration.
 */
export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<Shell savia={savia} />);
}
