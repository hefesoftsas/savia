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
import { OfficeAvailabilityContext } from "@/features/office-settings/office-availability";
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
          insufficientEvidence: true,
          stale: true,
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
    "The deadline is 15 June.\n\nThe available sources do not support a complete answer.\n\nThis answer uses an earlier source version.\n\nSources:\n- Tender terms, page 4 [source-7]\n  > Submissions close on 15 June.\n- Evaluation guide\n  > The evaluation starts the next day.",
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
  expect(copiedConversation).toContain(
    "The available sources do not support a complete answer.",
  );
  expect(copiedConversation).toContain(
    "This answer uses an earlier source version.",
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

it("ignores a clipboard result from a previous provider context", async () => {
  let resolveClipboard!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveClipboard = resolve;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const answer = { id: "answer", role: "assistant" as const, text: "Summary." };
  const provider: PluginAssistantProvider = {
    sessionId: "same-session",
    title: "Dossier",
    actionId: "chat",
    context: { companyProfileId: "company-1" },
    close: vi.fn(),
    invoke: vi.fn().mockResolvedValue({ revision: 1, messages: [answer] }),
  };
  const { rerender } = render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Copy answer" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  rerender(
    <ExternalAssistantConversation
      provider={{ ...provider, context: { companyProfileId: "company-2" } }}
      onReturn={() => {}}
    />,
  );
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  resolveClipboard();
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});

it("reloads after a failed terminal poll and allows sending again", async () => {
  let loadCount = 0;
  const invoke = vi.fn(async (request: PluginAssistantRequest) => {
    if (request.method === "load") {
      loadCount += 1;
      return loadCount === 1
        ? {
            revision: 1,
            pendingJobId: "job-1",
            messages: [
              { id: "user-1", role: "user" as const, text: "Question" },
            ],
          }
        : {
            revision: 2,
            messages: [
              { id: "user-1", role: "user" as const, text: "Question" },
            ],
          };
    }
    if (request.method === "poll") {
      throw Object.assign(new Error("Job failed"), { status: 409 });
    }
    return {
      revision: 3,
      messages: [
        { id: "user-1", role: "user" as const, text: "Question" },
        { id: "answer-1", role: "assistant" as const, text: "Retried answer." },
      ],
    };
  });
  const provider: PluginAssistantProvider = {
    sessionId: "failed-job",
    title: "Dossier",
    actionId: "chat",
    context: {},
    initialMessage: "Question",
    invoke,
    close: vi.fn(),
  };
  render(
    <ExternalAssistantConversation provider={provider} onReturn={() => {}} />,
  );

  await waitFor(
    () =>
      expect(invoke).toHaveBeenCalledWith({ method: "poll", jobId: "job-1" }),
    { timeout: 3_000 },
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Job failed");
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  const send = screen.getByRole("button", { name: /^Send$/ });
  expect(send).toBeEnabled();
  fireEvent.click(send);
  await screen.findByText("Retried answer.");
  expect(
    invoke.mock.calls.filter(([request]) => request.method === "send"),
  ).toHaveLength(1);
});

it("generates an advertised document without replacing chat history or its draft", async () => {
  const postForm = vi.fn(async () => ({ data: { id: "saved-proposal" } }));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new Uint8Array([80, 75]), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
        }),
    ),
  );
  const replace = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({
    opener: window,
    close: vi.fn(),
    location: { replace },
    document: { createElement: () => ({}), head: { append: vi.fn() } },
  } as never);
  const invoke = vi.fn(async (request: PluginAssistantRequest) =>
    request.method === "generate-document"
      ? {
          revision: 0,
          messages: [],
          document: {
            url: "https://provider.test/private/proposal/ticket",
            fileName: "proposal.docx",
            format: "docx" as const,
          },
        }
      : {
          revision: 4,
          messages: [
            {
              id: "answer",
              role: "assistant" as const,
              text: "Saved dossier answer",
            },
          ],
          documentActions: [
            {
              id: "proposal-docx",
              label: "Generate proposal DOCX",
              format: "docx" as const,
            },
          ],
        },
  );
  const current: PluginAssistantProvider = {
    sessionId: "document-integration",
    title: "Tender",
    actionId: "chat",
    context: { dossierId: "tender", companyProfileId: "company" },
    invoke,
    close: vi.fn(),
  };
  render(
    <OfficeAvailabilityContext.Provider
      value={{ enabled: true, loading: false, error: false }}
    >
      <ExternalAssistantConversation
        provider={current}
        onReturn={() => {}}
        apiClient={{ postForm } as never}
      />
    </OfficeAvailabilityContext.Provider>,
  );
  const button = await screen.findByRole("button", {
    name: "Generate proposal DOCX",
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(button);
  await screen.findByRole("link", { name: "Open document" });
  expect(postForm).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith(
    "/office/?base=%2Fv1%2Foffice-documents&file=saved-proposal",
  );
  expect(screen.getByText("Saved dossier answer")).toBeVisible();
  expect(screen.getByLabelText("Message")).toHaveValue("Keep this draft");
  expect(invoke.mock.calls.map(([request]) => request.method)).toEqual([
    "load",
    "generate-document",
  ]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
