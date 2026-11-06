import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import { RenewalsScreen } from "../../packages/insurance-renewals/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<RenewalsScreen savia={savia} />);
}

/** Mount a fresh editor for one host activation. */
export function renderPanel(el: HTMLElement, savia: PluginApi) {
  const root = createRoot(el);
  root.render(<RenewalsScreen savia={savia} />);
  return () => root.unmount();
}
