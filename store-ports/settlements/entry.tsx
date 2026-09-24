import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/crm-shared/src/plugin-api";
import { Screen } from "../../packages/insurance-settlements/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<Screen savia={savia} />);
}
