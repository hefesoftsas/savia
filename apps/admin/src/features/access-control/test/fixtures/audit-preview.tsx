import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditBrowser from "../../audit-browser";
import type {
  AuditFilters,
  AccessAuditEntry,
} from "@/api/access-control-client";
import "@/styles/globals.css";
const events: AccessAuditEntry[] = [
  {
    id: "test-event-role",
    scope: "tenant:101",
    actor: { id: "test-actor-ada", displayName: "Ada Rivera" },
    action: "role.saved",
    targetId: "Operations reviewer",
    createdAt: "2026-09-19T12:30:00.000Z",
  },
  {
    id: "test-event-member",
    scope: "tenant:101",
    actor: { id: "test-actor-alex", displayName: "Alex Chen" },
    action: "assignments.saved",
    targetId: "test-member-jordan",
    createdAt: "2026-09-19T12:20:00.000Z",
  },
];
const client = {
  listAudit: async (_scope: string, filters: AuditFilters = {}) => ({
    data: events.filter(
      (e) =>
        (!filters.action || e.action === filters.action) &&
        (!filters.actorId || e.actor.id === filters.actorId) &&
        (!filters.targetId || e.targetId === filters.targetId),
    ),
    nextCursor: null,
  }),
  getAudit: async (_scope: string, id: string) => ({
    ...events.find((e) => e.id === id)!,
    before: { label: "Reviewer", enabled: false, grants: [] },
    after: {
      label: "Operations reviewer",
      enabled: true,
      grants: [
        {
          resource: "collection:requests",
          action: "read",
          fields: ["title", "status"],
        },
      ],
    },
  }),
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">
        Visual verification fixture · synthetic data only
      </p>
      <header>
        <h1 className="text-2xl font-semibold">Roles and permissions</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Workspace: Operations
        </p>
      </header>
      <AuditBrowser client={client} scope="tenant:101" />
    </main>
  </QueryClientProvider>,
);
