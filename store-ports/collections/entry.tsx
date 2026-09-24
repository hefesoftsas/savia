import { createRoot } from "react-dom/client";
import { CollectionsScreen } from "../../packages/insurance-collections/src/admin";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";

/**
 * Adaptador del store: monta la pantalla real de Cartera con el objeto
 * `savia` del sandbox. Versión 1.1.0 del port (el release va en 1.0.0)
 * para que la instalación migre sin cambiar el id.
 */
export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<CollectionsScreen savia={savia} />);
}
