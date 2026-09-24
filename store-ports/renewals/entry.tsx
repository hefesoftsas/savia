import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import { RenewalsScreen } from "../../packages/insurance-renewals/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<RenewalsScreen savia={savia} />);
}
