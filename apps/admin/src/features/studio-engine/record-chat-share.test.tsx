// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { render } from "./test/locale-test-render";
import { RecordChatShareAction } from "./record-chat-share";

const share = {
  title: "Annual renewal",
  summary: "Customer asked for a revised quote.",
  url: "https://savia.example/admin?object=deals&view=records&record=1",
  context: {
    apiBasePath: "/v1/studio/7",
    collection: "deals",
    recordId: "1",
    fields: ["name", "status"],
  },
};
const connected = (provider: "slack" | "microsoft_teams") => ({
  id: `${provider}-connection`,
  provider,
  status: "connected" as const,
  externalAccountLabel: null,
  scopes: [],
  lastValidatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const clientFactory = () => ({
  listConnections: vi.fn().mockResolvedValue([]),
  listCollaborationChannels: vi.fn(),
  shareRecordToChat: vi.fn(),
});
function mount(client: ReturnType<typeof clientFactory>) {
  return render(
    <MemoryRouter>
      <RecordChatShareAction
        share={share}
        personalIntegrations={client as never}
      />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

it("offers a reconnect path when no chat provider is connected", async () => {
  const client = clientFactory();
  mount(client);

  fireEvent.click(screen.getByRole("button", { name: "Compartir en chat" }));

  expect(
    await screen.findByText(
      "Conecta Slack o Microsoft Teams para compartir este registro.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Abrir integraciones" }),
  ).toHaveAttribute("href", "/my-integrations?tab=connections");
  expect(client.listCollaborationChannels).not.toHaveBeenCalled();
});

it("labels the integration action as reconnect when authorization expired", async () => {
  const client = clientFactory();
  client.listConnections.mockResolvedValue([
    {
      ...connected("slack"),
      status: "reconnect_required",
    },
  ] as never);
  mount(client);

  fireEvent.click(screen.getByRole("button", { name: "Compartir en chat" }));

  expect(
    await screen.findByRole("link", { name: "Reconectar en integraciones" }),
  ).toHaveAttribute("href", "/my-integrations?tab=connections");
});

it("selects Teams channels, shows their team, and loads another page", async () => {
  const client = clientFactory();
  client.listConnections.mockResolvedValue([
    connected("microsoft_teams"),
  ] as never);
  client.listCollaborationChannels
    .mockResolvedValueOnce({
      channels: [
        {
          id: "channel-1",
          name: "general",
          teamId: "team-1",
          teamName: "Product",
        },
      ],
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      channels: [
        {
          id: "channel-2",
          name: "launch",
          teamId: "team-2",
          teamName: "Growth",
        },
      ],
      nextCursor: null,
    });
  mount(client);

  fireEvent.click(screen.getByRole("button", { name: "Compartir en chat" }));

  expect(
    await screen.findByRole("option", { name: "Product · general" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cargar más canales" }));
  expect(
    await screen.findByRole("option", { name: "Growth · launch" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Canal"), {
    target: { value: "team-2:channel-2" },
  });
  expect(
    screen.getByRole("button", { name: "Revisar y compartir" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Revisar y compartir" }));
  fireEvent.click(screen.getByRole("button", { name: "Compartir ahora" }));
  await waitFor(() =>
    expect(client.shareRecordToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "microsoft_teams",
        channelId: "channel-2",
        teamId: "team-2",
      }),
    ),
  );
});

it("discards channel results when the authenticated identity changes", async () => {
  const client = clientFactory();
  client.listConnections.mockResolvedValue([connected("slack")] as never);
  let resolveChannels!: (value: unknown) => void;
  client.listCollaborationChannels.mockImplementation(
    () => new Promise((resolve) => (resolveChannels = resolve)),
  );
  mount(client);

  fireEvent.click(screen.getByRole("button", { name: "Compartir en chat" }));
  await waitFor(() =>
    expect(client.listCollaborationChannels).toHaveBeenCalledTimes(1),
  );
  window.dispatchEvent(new Event("savia:identity-changed"));
  resolveChannels({
    channels: [{ id: "old-user-channel", name: "Private" }],
    nextCursor: null,
  });

  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("Private")).not.toBeInTheDocument();
});

it("ignores a channel response after the user switches providers", async () => {
  const client = clientFactory();
  client.listConnections.mockResolvedValue([
    connected("slack"),
    connected("microsoft_teams"),
  ] as never);
  let resolveSlack!: (value: unknown) => void;
  client.listCollaborationChannels
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlack = resolve)),
    )
    .mockResolvedValueOnce({
      channels: [
        {
          id: "teams-1",
          name: "planning",
          teamId: "team-1",
          teamName: "Product",
        },
      ],
      nextCursor: null,
    });
  mount(client);

  fireEvent.click(screen.getByRole("button", { name: "Compartir en chat" }));
  fireEvent.change(await screen.findByLabelText("Proveedor"), {
    target: { value: "microsoft_teams" },
  });
  expect(
    await screen.findByRole("option", { name: "Product · planning" }),
  ).toBeInTheDocument();
  resolveSlack({
    channels: [{ id: "slack-1", name: "stale-channel" }],
    nextCursor: null,
  });
  await waitFor(() =>
    expect(screen.queryByText("stale-channel")).not.toBeInTheDocument(),
  );
});

it("reuses the request id after an ambiguous send error and blocks duplicate submits", async () => {
  const client = clientFactory();
  client.listConnections.mockResolvedValue([connected("slack")] as never);
  client.listCollaborationChannels.mockResolvedValue({
    channels: [{ id: "channel-1", name: "general" }],
    nextCursor: null,
  });
  let rejectSend!: (error: Error) => void;
  client.shareRecordToChat.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (rejectSend = reject)),
  );
  client.shareRecordToChat.mockResolvedValueOnce({
    provider: "slack",
    messageId: "message-1",
  });
  mount(client);
  fireEvent.click(screen.getByRole("button", { name: "Compartir en chat" }));
  await screen.findByRole("option", { name: "general" });
  fireEvent.change(await screen.findByLabelText("Canal"), {
    target: { value: ":channel-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar y compartir" }));
  const submit = screen.getByRole("button", { name: "Compartir ahora" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(client.shareRecordToChat).toHaveBeenCalledTimes(1);
  const sentInput = client.shareRecordToChat.mock.calls[0][0];
  rejectSend(new Error("network timeout"));

  expect(
    await screen.findByText(
      "No pudimos confirmar el envío. Revisa el canal antes de intentarlo de nuevo.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
  await waitFor(() =>
    expect(client.shareRecordToChat).toHaveBeenCalledTimes(2),
  );
  expect(client.shareRecordToChat.mock.calls[1][0].requestId).toBe(
    sentInput.requestId,
  );
});

it("requires channel confirmation and a fresh request id after delivery is unknown", async () => {
  const client = clientFactory();
  client.listConnections.mockResolvedValue([connected("slack")] as never);
  client.listCollaborationChannels.mockResolvedValue({
    channels: [{ id: "channel-1", name: "general" }],
    nextCursor: null,
  });
  const deliveryUnknown = Object.assign(new Error("Delivery unknown"), {
    status: 409,
    code: "PERSONAL_COLLABORATION_DELIVERY_UNKNOWN",
  });
  client.shareRecordToChat
    .mockRejectedValueOnce(new Error("network timeout"))
    .mockRejectedValueOnce(deliveryUnknown)
    .mockResolvedValueOnce({ provider: "slack", messageId: "message-2" });

  mount(client);
  fireEvent.click(screen.getByRole("button", { name: "Compartir en chat" }));
  await screen.findByRole("option", { name: "general" });
  fireEvent.change(await screen.findByLabelText("Canal"), {
    target: { value: ":channel-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revisar y compartir" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Compartir ahora" }),
  );
  const originalRequestId = client.shareRecordToChat.mock.calls[0][0].requestId;

  fireEvent.click(
    await screen.findByRole("button", { name: "Intentar de nuevo" }),
  );
  const confirmation = await screen.findByRole("checkbox", {
    name: "He revisado el canal y quiero realizar un nuevo envío.",
  });
  expect(client.shareRecordToChat.mock.calls[1][0].requestId).toBe(
    originalRequestId,
  );
  expect(
    screen.queryByRole("button", { name: "Compartir ahora" }),
  ).not.toBeInTheDocument();
  const freshSend = screen.getByRole("button", {
    name: "Realizar nuevo envío",
  });
  expect(freshSend).toBeDisabled();
  fireEvent.click(confirmation);
  expect(freshSend).toBeEnabled();
  fireEvent.click(freshSend);

  await waitFor(() =>
    expect(client.shareRecordToChat).toHaveBeenCalledTimes(3),
  );
  expect(client.shareRecordToChat.mock.calls[2][0].requestId).not.toBe(
    originalRequestId,
  );
});
