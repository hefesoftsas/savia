import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";

import { ThemeProvider } from "@/components/theme-provider";

import App, { FallbackErrorUI } from "./app";
import { routes } from "./routes";
import { installSaviaFlowsTransport } from "./savia/transport";

const rootElement = document.getElementById("root")!;
const transportMode = installSaviaFlowsTransport();

if (transportMode === "standalone") {
  createRoot(rootElement).render(
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <p className="text-sm font-semibold text-emerald-700">Savia Flows</p>
      <h1 className="mt-3 text-2xl font-semibold">
        Open Savia Flows from your Savia workspace
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Savia Flows uses the active Savia session and tenant. There is no
        separate sign-in for this editor.
      </p>
    </main>,
  );
} else if (transportMode === "public") {
  const publicPaths = new Set([
    "/form/:signedToken",
    "/forms/:workflowId",
    "/feedback/:signedToken",
  ]);
  const publicRouter = createBrowserRouter(
    [
      {
        element: (
          <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
            <Outlet />
          </ThemeProvider>
        ),
        children: routes.filter((route) => publicPaths.has(route.path ?? "")),
        errorElement: (
          <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
            <FallbackErrorUI />
          </ThemeProvider>
        ),
      },
    ],
    { basename: "/flows-ui" },
  );
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={publicRouter} />
    </StrictMode>,
  );
} else {
  const rootRouter = createBrowserRouter(
    [
      {
        element: <App />,
        children: routes,
        errorElement: (
          <StrictMode>
            <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
              <FallbackErrorUI />
            </ThemeProvider>
          </StrictMode>
        ),
      },
    ],
    { basename: "/flows-ui" },
  );

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={rootRouter} />
    </StrictMode>,
  );
}
