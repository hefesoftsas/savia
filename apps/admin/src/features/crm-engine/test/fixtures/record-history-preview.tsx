import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeConfig } from "@savia/crm-shared/metadata";
import RecordHistory from "../../record-history";
import SettingsButton from "../../record-history-settings";
import { setCrmRuntime } from "../../runtime";
import "@/styles/globals.css";
import "../../operations.css";
const object = {
  name: "requests",
  label: "Solicitudes",
  description: "",
  config: makeConfig({
    title: { type: "Textbox", label: "Título" },
    status: { type: "Dropdown", label: "Estado" },
    approved: { type: "Toggle", label: "Aprobado" },
  }),
};
const entry = {
  version: 2,
  action: "updated",
  createdAt: "2026-09-19T12:15:00.000Z",
  actor: { kind: "user", id: "example-reviewer", causeId: null },
  fields: ["status", "approved"],
};
let settings = {
    enabled: true,
    fields: ["title", "status", "approved"],
    retentionDays: 90,
  },
  version = 1;
setCrmRuntime({
  embedded: false,
  transport: async (path, init) => {
    if (path.endsWith("/usage"))
      return Response.json({
        data: {
          events: 2,
          logicalBytes: 140,
          expiredEvents: 0,
          oldestExpiredAt: null,
          limited: false,
          measuredAt: new Date().toISOString(),
        },
      });
    if (path.endsWith("/restore"))
      return Response.json({
        data: {
          expectedVersion: 2,
          changes: {
            status: {
              current: "Aprobada",
              before: "En revisión",
              after: "Aprobada",
            },
            approved: { current: true, before: false, after: true },
          },
        },
      });
    if (path.includes("record-history-settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        settings = {
          enabled: body.enabled,
          fields: body.fields,
          retentionDays: body.retentionDays,
        };
        version++;
      }
      return Response.json({ data: settings, version });
    }
    if (path.endsWith("/2"))
      return Response.json({
        data: {
          ...entry,
          changes: {
            status: { before: "En revisión", after: "Aprobada" },
            approved: { before: false, after: true },
          },
        },
      });
    return Response.json({
      data: [
        entry,
        { ...entry, version: 1, action: "created", fields: ["title"] },
      ],
      nextCursor: null,
      enabled: settings.enabled,
      retentionDays: settings.retentionDays,
    });
  },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">
        Visual verification fixture · synthetic data only
      </p>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Solicitud de acceso</h1>
        <SettingsButton object={object} />
      </header>
      <RecordHistory object={object} recordId="example-record" />
    </main>
  </QueryClientProvider>,
);
