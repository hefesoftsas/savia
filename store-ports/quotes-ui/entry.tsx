import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  InsurancePackageAdminScreen,
  InsuranceQuoteWizardScreen,
  InsuranceQuoteWorkspaceScreen,
} from "../../packages/insurance-quotes/src/screens/quote-screens";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";

type Tab = "direct" | "wizard" | "admin";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "direct", label: "Directa" },
  { id: "wizard", label: "Por pasos" },
  { id: "admin", label: "Administrar" },
];

/**
 * Adaptador del store: monta las tres pantallas del cotizador con el
 * objeto `savia` del sandbox (colecciones + ajustes + acciones
 * delegadas + lookups del host).
 */
function Shell({ savia }: { savia: PluginApi }) {
  const [tab, setTab] = useState<Tab>("direct");
  return (
    <div>
      <nav aria-label="Cotizador">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "direct" ? (
        <InsuranceQuoteWorkspaceScreen savia={savia} />
      ) : null}
      {tab === "wizard" ? <InsuranceQuoteWizardScreen savia={savia} /> : null}
      {tab === "admin" ? <InsurancePackageAdminScreen savia={savia} /> : null}
    </div>
  );
}

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<Shell savia={savia} />);
}
