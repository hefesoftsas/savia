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

it("finds an exact source reference in a long cited answer", async () => {
  const provider: PluginAssistantProvider = {
    sessionId: "searchable-sources",
    title: "Dossier",
    actionId: "chat",
    context: {},
    close: vi.fn(),
    invoke: vi.fn().mockResolvedValue({
      revision: 1,
      messages: [
        {
          id: "answer",
          role: "assistant",
          text: "Use source S009.",
          citations: Array.from({ length: 10 }, (_, i) => ({
            id: `S${String(i + 1).padStart(3, "0")}`,
            label: `Document ${i + 1}`,
            excerpt: `Original passage ${i + 1}.`,
          })),
        },
      ],
    }),
  };
  render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );
  await waitFor(() => expect(screen.getByText("Sources (10)")).toBeTruthy());
  fireEvent.click(screen.getByText("Sources (10)"));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search sources" }), {
    target: { value: "S009" },
  });
  expect(screen.getByText("Original passage 9.")).toBeTruthy();
  expect(screen.queryByText("Original passage 1.")).toBeNull();
});

it("copies an answer and the loaded conversation with readable citations", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const provider: PluginAssistantProvider = {
    sessionId: "copy-conversation",
    title: "Tender dossier",
    actionId: "chat",
    context: {},
    close: vi.fn(),
    invoke: vi.fn().mockResolvedValue({
      revision: 4,
      messages: [
        {
          id: "user-hash-is-private",
          role: "user",
          text: "Review this tender",
        },
        {
          id: "answer-hash-is-private",
          role: "assistant",
          text: "The deadline is 15 June.",
          citations: [
            {
              id: "source-7",
              label: "Tender terms, page 4",
              excerpt: "Submissions close on 15 June.",
            },
            {
              id: "b48c6df284ed9a01",
              label: "Evaluation guide",
              excerpt: "The evaluation starts the next day.",
            },
          ],
        },
      ],
    }),
  };
  render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );

  const copyAnswer = await screen.findByRole("button", { name: "Copy answer" });
  fireEvent.click(copyAnswer);
  expect(await screen.findByRole("status")).toHaveTextContent("Answer copied.");
  expect(writeText).toHaveBeenNthCalledWith(
    1,
    "The deadline is 15 June.\n\nSources:\n- Tender terms, page 4 [source-7]\n  > Submissions close on 15 June.\n- Evaluation guide\n  > The evaluation starts the next day.",
  );

  fireEvent.click(screen.getByRole("button", { name: "Copy conversation" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Conversation copied.",
  );
  const copiedConversation = writeText.mock.calls[1][0] as string;
  expect(copiedConversation).toContain("# Tender dossier");
  expect(copiedConversation).toContain("## You\n\nReview this tender");
  expect(copiedConversation).toContain(
    "## Assistant\n\nThe deadline is 15 June.",
  );
  expect(copiedConversation).toContain("Tender terms, page 4 [source-7]");
  expect(copiedConversation).toContain("Evaluation guide");
  expect(copiedConversation).not.toContain("b48c6df284ed9a01");
  expect(copiedConversation).not.toContain("answer-hash-is-private");
});

it("announces clipboard failures", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  const provider: PluginAssistantProvider = {
    sessionId: "copy-error",
    title: "Dossier",
    actionId: "chat",
    context: {},
    close: vi.fn(),
    invoke: vi.fn().mockResolvedValue({
      revision: 1,
      messages: [{ id: "answer", role: "assistant", text: "Summary." }],
    }),
  };
  render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Copy answer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to copy. Clipboard access is unavailable.",
  );
});

it("clears copy feedback when the conversation messages change", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  const provider: PluginAssistantProvider = {
    sessionId: "copy-reset",
    title: "Dossier",
    actionId: "chat",
    context: { companyProfileId: "company-1" },
    close: vi.fn(),
    invoke: vi
      .fn()
      .mockResolvedValueOnce({
        revision: 1,
        messages: [
          { id: "answer-1", role: "assistant", text: "First answer." },
        ],
      })
      .mockResolvedValueOnce({
        revision: 2,
        messages: [
          { id: "answer-1", role: "assistant", text: "First answer." },
          { id: "user-2", role: "user", text: "Follow-up" },
          { id: "answer-2", role: "assistant", text: "Second answer." },
        ],
      }),
  };
  render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Copy answer" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Answer copied.");

  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Follow-up" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  await screen.findByText("Second answer.");
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(screen.getAllByRole("button", { name: "Copy answer" })).toHaveLength(
    2,
  );
});
