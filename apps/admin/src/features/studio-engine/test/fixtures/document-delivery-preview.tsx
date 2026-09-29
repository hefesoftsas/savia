import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoreContextProvider, memoryStore } from "ra-core";
import { FileText, ShieldAlert } from "lucide-react";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { DocumentDeliveryActions } from "../../document-delivery-actions";
import { CreateOfficeAttachment } from "../../create-office-attachment";
import { OfficeEditButton } from "../../office-edit-button";
import { setStudioRuntime } from "../../runtime";
import "@/styles/globals.css";
import "../../operations.css";

const file = {
  id: "proposal_2026",
  name: new URLSearchParams(window.location.search).has("long-name")
    ? "BEAC-8339_Alnylam_Vault_Mappings_and_Selection_Criteria_v2_human_readable.docx"
    : "proposal.docx",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 482_314,
  version: 3,
};
const context = {
  file,
  connections: [
    {
      key: "onedrive-personal-generation-3",
      provider: "onedrive_personal",
      status: "connected",
      externalAccountLabel: "alex@example.test",
    },
    {
      key: "outlook-generation-2",
      provider: "outlook",
      status: "connected",
      externalAccountLabel: "alex@example.test",
    },
  ],
  history: [
    {
      id: "delivery-101",
      action: "onedrive",
      provider: "onedrive_personal",
      version: 3,
      status: "succeeded",
      createdAt: "2026-09-25T14:42:00.000Z",
      actorId: "actor-01",
      actorName: "Alex Martínez",
    },
    {
      id: "delivery-098",
      action: "outlook",
      provider: "outlook",
      version: 2,
      status: "unknown",
      createdAt: "2026-09-24T11:20:00.000Z",
      actorId: "actor-02",
      actorName: "María Ruiz",
    },
  ],
};
const simulation = new URLSearchParams(window.location.search).get("simulate");
const preparedAction: { value: "onedrive" | "outlook" | null } = {
  value: null,
};

setStudioRuntime({
  embedded: false,
  apiBasePath: "/v1/studio/0",
  transport: async (path, init) => {
    if (path.endsWith("/delivery")) return Response.json({ data: context });
    if (path.includes("/delivery/folders?")) {
      const params = new URL(path, window.location.origin).searchParams;
      return Response.json({
        data: params.get("parentId")
          ? [{ id: "q3-drafts", name: "Q3 drafts" }]
          : [
              { id: "shared", name: "Shared" },
              { id: "contracts", name: "Contracts" },
              { id: "proposals", name: "Proposals" },
            ],
      });
    }
    if (path.endsWith("/delivery/prepare")) {
      preparedAction.value = JSON.parse(String(init?.body)).action;
      return Response.json({
        data: {
          confirmationId: "preview-confirmation",
          token: "preview-token",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      });
    }
    if (path.endsWith("/delivery/confirm")) {
      if (simulation === "unknown")
        return Response.json(
          {
            error: {
              code: "DELIVERY_STATUS_UNKNOWN",
              message:
                "The simulated result is unknown. No remote account is contacted in this preview.",
            },
          },
          { status: 502 },
        );
      return Response.json({
        data: {
          action: preparedAction.value,
          status: "succeeded",
          webUrl: "https://example.test/preview/proposal.docx",
        },
      });
    }
    return Response.json(
      {
        error: {
          code: "PREVIEW_ROUTE_MISSING",
          message: "No fixture route matched.",
        },
      },
      { status: 404 },
    );
  },
});

createRoot(document.getElementById("root")!).render(
  <StoreContextProvider value={memoryStore({ locale: "es" })}>
    <AppLocaleProvider>
      <QueryClientProvider client={new QueryClient()}>
        <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
          <div
            role="note"
            className="flex items-start gap-3 rounded-md border border-amber-600/30 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <ShieldAlert
              className="mt-0.5 shrink-0"
              size={18}
              aria-hidden="true"
            />
            <p className="font-medium">
              Vista de prueba · datos de ejemplo · no envía correos ni guarda
              archivos en Microsoft
            </p>
          </div>
          <header className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Documentos de la solicitud
            </p>
            <h1 className="text-2xl font-semibold">
              Propuesta comercial · Savia Norte
            </h1>
          </header>
          <CreateOfficeAttachment onCreate={async () => {}} />
          <section className="grid gap-4 rounded-lg border bg-background p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <FileText size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="break-all font-medium">{file.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Documento Word · 471 KB · Versión 3 · Actualizado el 25 sep
                  2026
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <OfficeEditButton file={file} />
              <DocumentDeliveryActions file={file} />
            </div>
          </section>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            La vista previa usa cuentas Microsoft simuladas y carpetas de
            ejemplo. Las acciones solo prueban la interfaz de revisión y
            confirmación.
          </p>
        </main>
      </QueryClientProvider>
    </AppLocaleProvider>
  </StoreContextProvider>,
);
