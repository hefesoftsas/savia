import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import { CommunicationsScreen } from "../../packages/insurance-communications/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<CommunicationsScreen savia={savia} />);
}
