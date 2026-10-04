import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DeploymentBoundary } from "./pwa/deployment-recovery-ui";
import { receiveSharedLink } from "./pwa/share-target";
import { ApplicationRoot } from "./bootstrap";
import "./styles/globals.css";

receiveSharedLink();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeploymentBoundary>
      <ApplicationRoot />
    </DeploymentBoundary>
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.on("savia:plugin-development-reload", (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      !Number.isSafeInteger((payload as { tenant?: unknown }).tenant)
    )
      return;
    const tenantId = String((payload as { tenant: number }).tenant);
    void Promise.all([
      import("./app-services"),
      import("./features/studio-engine/studio-query-cache"),
    ])
      .then(async ([services, studioCache]) => {
        await services.getDefaultAppServices().localData.forgetMetadata();
        await studioCache.invalidateStudioTenantQueries(tenantId);
        window.dispatchEvent(new Event("savia-studio-objects-changed"));
      })
      .catch((error: unknown) => {
        console.error("Could not refresh local plugin metadata.", error);
      });
  });
}
