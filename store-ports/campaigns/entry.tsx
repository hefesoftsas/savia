import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/crm-shared/src/plugin-api";
import { CampaignsScreen } from "../../packages/insurance-campaigns/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<CampaignsScreen savia={savia} />);
}
