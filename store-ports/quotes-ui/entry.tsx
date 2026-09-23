import { createRoot } from "react-dom/client";
import { InsuranceQuoteWorkspaceScreen } from "../../packages/insurance-quotes/src/screens/quote-screens";
import type { PluginApi } from "../../packages/crm-shared/src/plugin-api";

/**
 * Adaptador del store: monta la pantalla directa del cotizador con el
 * objeto `savia` del sandbox (colecciones + ajustes + acciones
 * simuladas + lookups del host).
 */
export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<InsuranceQuoteWorkspaceScreen savia={savia} />);
}
