import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/studio-shared/src/plugin-api";
import { DocumentGenerationScreen } from "../../packages/insurance-document-generation/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<DocumentGenerationScreen savia={savia} />);
}
