import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import { CarriersScreen } from "../../packages/insurance-carriers/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<CarriersScreen savia={savia} />);
}
