import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeConfig } from "@savia/studio-shared/metadata";
import Workflows from "../../workflows";
import { setStudioRuntime } from "../../runtime";
import "../../../../styles/globals.css";
setStudioRuntime({
  embedded: true,
  transport: (path, init) => fetch(`http://127.0.0.1:8896${path}`, init),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <main style={{ padding: 24, maxWidth: 1400, margin: "auto" }}>
      <p>Entorno de verificación aislado · datos de prueba en D1 local</p>
      <Workflows
        objects={[
          {
            name: "requests",
            label: "Solicitudes",
            config: makeConfig({
              title: { type: "Textbox", label: "Título" },
              amount: { type: "Number", label: "Importe" },
              status: { type: "Textbox", label: "Estado" },
            }),
          },
        ]}
      />
    </main>
  </QueryClientProvider>,
);
