// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExternalAssistantConversation } from "./assistant-bar";
import type {
  PluginAssistantProvider,
  PluginAssistantRequest,
} from "@savia/studio-shared/plugin-assistant";

afterEach(cleanup);

it("loads provider history, leaves the seed in the composer, then sends and renders cited answers", async () => {
  const invoke = vi.fn(async (request: PluginAssistantRequest) =>
    request.method === "load"
      ? { conversationId: "conversation-1", revision: 2, messages: [] }
      : {
          conversationId: "conversation-1",
          revision: 3,
          messages: [
            { id: "user-1", role: "user" as const, text: "Check this tender" },
            {
              id: "answer-1",
              role: "assistant" as const,
              text: "Review **all requirements**.",
              citations: [
                {
                  id: "source-1",
                  label: "Terms · page 4",
                  excerpt: "The bidder must...",
                },
              ],
              insufficientEvidence: true,
            },
          ],
        },
  );
  const provider: PluginAssistantProvider = {
    sessionId: "provider-1",
    title: "Tender dossier",
    actionId: "assistant-chat",
    context: { dossierId: "dossier-1" },
    initialMessage: "Check this tender",
    invoke,
    close: vi.fn(),
  };
  render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );

  const composer = screen.getByLabelText("Message") as HTMLTextAreaElement;
  await waitFor(() => expect(invoke).toHaveBeenCalledWith({ method: "load" }));
  expect(composer.value).toBe("Check this tender");
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));

  await waitFor(() =>
    expect(
      screen.getByText(
        (_content, element) =>
          element?.textContent === "Review all requirements.",
      ),
    ).toBeTruthy(),
  );
  expect(composer.value).toBe("");
  expect(invoke.mock.calls[1][0]).toMatchObject({
    method: "send",
    message: "Check this tender",
    conversationId: "conversation-1",
    expectedRevision: 2,
  });
  expect(
    screen.getByText("The available sources do not support a complete answer."),
  ).toBeTruthy();
  fireEvent.click(screen.getByText("Sources (1)"));
  expect(screen.getByText("The bidder must...")).toBeTruthy();
});

it("preserves the draft when the external action fails", async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ revision: 0, messages: [] })
    .mockRejectedValueOnce(new Error("Provider unavailable"))
    .mockResolvedValueOnce({
      revision: 1,
      messages: [{ id: "user-1", role: "user" as const, text: "Try again" }],
    });
  const provider: PluginAssistantProvider = {
    sessionId: "provider-2",
    title: "Provider",
    actionId: "chat",
    context: {},
    invoke,
    close: vi.fn(),
  };
  render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );
  const composer = screen.getByLabelText("Message") as HTMLTextAreaElement;
  await waitFor(() => expect(composer.disabled).toBe(false));
  fireEvent.change(composer, { target: { value: "Try again" } });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Provider unavailable",
    ),
  );
  expect(composer.value).toBe("Try again");
  const firstAttempt = invoke.mock.calls[1][0];
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  await waitFor(() => expect(composer.value).toBe(""));
  expect(invoke.mock.calls[2][0]).toMatchObject({
    idempotencyKey: firstAttempt.idempotencyKey,
  });
});
