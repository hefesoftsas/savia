// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { render } from "./locale-test-render";
import { makeConfig } from "@savia/studio-shared/metadata";
import RecordDetail from "../record-detail";
import { api } from "../api";
import { setStudioRuntime } from "../runtime";

vi.mock("../api", () => ({
  api: vi.fn(),
  studioFetch: vi.fn(),
  downloadCrm: vi.fn(),
}));
vi.mock("../record-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../record-links")>();
  return { ...actual, default: () => <div /> };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setStudioRuntime({});
  window.history.replaceState(null, "", "/#/studio?tenantId=5&object=deals");
});

it("shares readable record fields with a canonical Studio record link", async () => {
  setStudioRuntime({ apiBasePath: "/v1/studio/5", tenantId: 5 });
  window.history.replaceState(null, "", "/#/studio?tenantId=5&object=deals");
  const record = {
    id: "deal-1",
    dealname: "Annual renewal",
    stage: "Negotiation",
  };
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/record-links/")
      ? { data: [] }
      : { data: { record, relations: [] } },
  );
  const personalIntegrations = {
    listConnections: vi.fn().mockResolvedValue([
      {
        id: "slack-1",
        provider: "slack",
        status: "connected",
        externalAccountLabel: null,
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
    listCollaborationChannels: vi.fn().mockResolvedValue({
      channels: [{ id: "channel-1", name: "sales" }],
      nextCursor: null,
    }),
    shareRecordToChat: vi
      .fn()
      .mockResolvedValue({ provider: "slack", messageId: "message-1" }),
  };
  const config = makeConfig({
    dealname: { type: "Textbox", label: "Nombre" },
    stage: { type: "Textbox", label: "Etapa" },
  });
  config.studio = {
    collection: {
      kind: "crm",
      sourceId: "hubspot",
      resource: "deals",
      capabilities: {
        list: true,
        read: true,
        create: false,
        update: false,
        delete: false,
        schema: false,
        customFields: false,
      },
    },
  };
  const queryClient = new QueryClient();
  render(
    <AppServicesProvider services={{ personalIntegrations } as never}>
      <QueryClientProvider client={queryClient}>
        <RecordDetail
          object={{ name: "deals", label: "Deals", description: "", config }}
          record={record}
          onEdit={vi.fn()}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onNavigate={vi.fn()}
        />
      </QueryClientProvider>
    </AppServicesProvider>,
  );

  fireEvent.click(
    await screen.findByRole("button", { name: "Compartir en chat" }),
  );
  await screen.findByRole("option", { name: "sales" });
  fireEvent.change(screen.getByLabelText("Canal"), {
    target: { value: ":channel-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar y compartir" }));
  expect(
    await screen.findByText(
      /#\/studio\?tenantId=5&object=deals&view=records&record=deal-1/,
    ),
  ).toBeVisible();
  const preview = screen.getByRole("region", { name: "Revisa el mensaje" });
  expect(within(preview).getByText("Annual renewal")).toBeVisible();
  expect(within(preview).getByText(/Etapa: Negotiation/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Compartir ahora" }));

  await waitFor(() =>
    expect(personalIntegrations.shareRecordToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining(
          "#/studio?tenantId=5&object=deals&view=records&record=deal-1",
        ),
        context: {
          apiBasePath: "/v1/studio/5",
          collection: "deals",
          recordId: "deal-1",
          fields: ["dealname", "stage"],
        },
      }),
    ),
  );
});
