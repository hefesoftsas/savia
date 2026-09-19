import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DeploymentBoundary } from "./pwa/deployment-recovery-ui";
import { ApplicationRoot } from "./bootstrap";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeploymentBoundary>
      <ApplicationRoot />
    </DeploymentBoundary>
  </StrictMode>,
);
