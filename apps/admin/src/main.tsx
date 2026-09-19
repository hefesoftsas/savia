import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationRoot } from "./bootstrap";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApplicationRoot />
  </StrictMode>,
);
