import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { applyCachedAppearance } from "./components/admin/appearance-cache";
import "./styles/globals.css";

applyCachedAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
