import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import { CalendarScreen } from "../../packages/insurance-calendar/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<CalendarScreen savia={savia} />);
}
