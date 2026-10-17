import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closePluginAssistantProvider,
  getPluginAssistantProvider,
  openPluginAssistantProvider,
  parsePluginAssistantOpenRequest,
  parsePluginAssistantResponse,
  subscribePluginAssistantProvider,
} from "../src/plugin-assistant";

afterEach(() => closePluginAssistantProvider("session-a"));

describe("plugin assistant bridge contracts", () => {
  it("accepts a bounded extension-owned provider request", () => {
    expect(
      parsePluginAssistantOpenRequest({
        title: "Tender dossier",
        actionId: "dossier-call",
        connectionId: "private-service",
        context: { dossierId: "dossier-1", companyProfileId: "company-2" },
        initialMessage: "Compare the evidence with every requirement.",
      }),
    ).toEqual({
      title: "Tender dossier",
      actionId: "dossier-call",
      connectionId: "private-service",
      context: { dossierId: "dossier-1", companyProfileId: "company-2" },
      initialMessage: "Compare the evidence with every requirement.",
    });
  });

  it.each([
    [{ title: "", actionId: "run", context: {} }],
    [{ title: "OK", actionId: "../other", context: {} }],
    [{ title: "OK", actionId: "run", connectionId: "", context: {} }],
    [{ title: "OK", actionId: "run", context: { bad: Number.NaN } }],
    [
      {
        title: "OK",
        actionId: "run",
        context: { payload: "x".repeat(20_000) },
      },
    ],
    [
      {
        title: "OK",
        actionId: "run",
        context: {},
        initialMessage: "x".repeat(8_001),
      },
    ],
    [{ title: "OK", actionId: "run", context: {}, url: "https://example.com" }],
  ])("rejects invalid or unbounded launch requests %#", (value) => {
    expect(parsePluginAssistantOpenRequest(value)).toBeNull();
  });

  it("accepts bounded document actions and a private DOCX download", () => {
    const response = {
      revision: 0,
      messages: [],
      documentActions: [
        {
          id: "proposal-docx",
          label: "Generar propuesta DOCX",
          format: "docx",
          fileName: "borrador-propuesta.docx",
        },
      ],
      document: {
        url: "https://service.test/private/proposal/ticket",
        fileName: "proposal-1.docx",
        format: "docx",
      },
    };
    expect(parsePluginAssistantResponse(response)).toEqual(response);
  });

  it.each([
    { documentActions: [{ id: "../run", label: "Export", format: "docx" }] },
    { documentActions: [{ id: "run", label: " ", format: "docx" }] },
    { documentActions: [{ id: "run", label: "Export", format: "exe" }] },
    {
      documentActions: [
        {
          id: "run",
          label: "Export",
          format: "docx",
          fileName: "../other.docx",
        },
      ],
    },
    {
      documentActions: Array.from({ length: 5 }, () => ({
        id: "run",
        label: "Export",
        format: "docx",
      })),
    },
    {
      documentActions: [
        { id: "run", label: "Export", format: "docx" },
        { id: "run", label: "Again", format: "docx" },
      ],
    },
    {
      document: {
        url: "javascript:alert(1)",
        fileName: "proposal.docx",
        format: "docx",
      },
    },
    {
      document: {
        url: "https://user:secret@service.test/file",
        fileName: "proposal.docx",
        format: "docx",
      },
    },
    {
      document: {
        url: "https://service.test/file",
        fileName: "../proposal.docx",
        format: "docx",
      },
    },
    {
      document: {
        url: "https://service.test/file",
        fileName: "proposal.exe",
        format: "docx",
      },
    },
    {
      document: {
        url: "https://service.test/file",
        fileName: "proposal.docx",
        format: "pdf",
      },
    },
  ])("rejects unsafe or unbounded document capabilities %#", (extra) => {
    expect(
      parsePluginAssistantResponse({ revision: 0, messages: [], ...extra }),
    ).toBeNull();
  });

  it("normalizes the external action response and citations", () => {
    expect(
      parsePluginAssistantResponse({
        data: {
          data: {
            conversationId: "conversation-1",
            revision: 4,
            messages: [
              {
                id: "turn-1",
                role: "assistant",
                text: "Respuesta **verificada**.",
                stale: false,
                citations: [
                  {
                    id: "doc-1",
                    label: "Pliego · página 4",
                    excerpt: "Requisito...",
                  },
                ],
              },
            ],
            pendingJobId: "job-1",
            coverage: { label: "Cobertura parcial", complete: false },
          },
        },
      }),
    ).toEqual({
      conversationId: "conversation-1",
      revision: 4,
      messages: [
        {
          id: "turn-1",
          role: "assistant",
          text: "Respuesta **verificada**.",
          stale: false,
          citations: [
            {
              id: "doc-1",
              label: "Pliego · página 4",
              excerpt: "Requisito...",
            },
          ],
        },
      ],
      pendingJobId: "job-1",
      coverage: { label: "Cobertura parcial", complete: false },
    });
    expect(
      parsePluginAssistantResponse({
        revision: 0,
        messages: [{ id: "1", role: "system", text: "no" }],
      }),
    ).toBeNull();
    expect(
      parsePluginAssistantResponse({ revision: -1, messages: [] }),
    ).toBeNull();
  });

  it("preserves long checklists and large source sets within the explicit response budget", () => {
    const citations = Array.from({ length: 149 }, (_, index) => ({
      id: `source-${index}`,
      label: `Requirement ${index + 1}`,
      excerpt: "Evidence excerpt.",
    }));
    const parsed = parsePluginAssistantResponse({
      revision: 4,
      messages: [
        {
          id: "answer-1",
          role: "assistant",
          text: "Requirement checklist.\n".repeat(3_000),
          citations,
        },
      ],
    });
    expect(parsed?.messages[0].text.length).toBeGreaterThan(50_000);
    expect(parsed?.messages[0].citations).toHaveLength(149);
    expect(
      parsePluginAssistantResponse({
        revision: 1,
        messages: [
          { id: "answer-1", role: "assistant", text: "x".repeat(500_001) },
        ],
      }),
    ).toBeNull();
  });

  it("accepts complete histories above 40 messages and rejects host-limit overflow", () => {
    const messages = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        text: `Message ${index}`,
      }));
    expect(
      parsePluginAssistantResponse({ revision: 1, messages: messages(41) })
        ?.messages,
    ).toHaveLength(41);
    expect(
      parsePluginAssistantResponse({ revision: 1, messages: messages(2_001) }),
    ).toBeNull();
    expect(
      parsePluginAssistantResponse({
        revision: 1,
        messages: Array.from({ length: 5 }, (_, index) => ({
          id: `large-${index}`,
          role: "assistant",
          text: "x".repeat(450_000),
        })),
      }),
    ).toBeNull();
  });

  it("does not let a replaced or revoked provider close a newer session", () => {
    const changes: string[] = [];
    const unsubscribe = subscribePluginAssistantProvider(() => {
      changes.push(getPluginAssistantProvider()?.sessionId ?? "closed");
    });
    const closeFirst = vi.fn();
    openPluginAssistantProvider({
      sessionId: "session-a",
      title: "A",
      actionId: "run",
      context: {},
      invoke: async () => ({ revision: 0, messages: [] }),
      close: closeFirst,
    });
    openPluginAssistantProvider({
      sessionId: "session-b",
      title: "B",
      actionId: "run",
      context: {},
      invoke: async () => ({ revision: 0, messages: [] }),
      close: () => {},
    });
    expect(closeFirst).toHaveBeenCalledOnce();
    closePluginAssistantProvider("session-a");
    expect(getPluginAssistantProvider()?.sessionId).toBe("session-b");
    closePluginAssistantProvider("session-b");
    expect(changes).toEqual(["session-a", "session-b", "closed"]);
    unsubscribe();
  });
});

it("preserves bounded source and requirement task capabilities", () => {
  const parsed = parsePluginAssistantResponse({
    revision: 1,
    messages: [
      {
        id: "a",
        role: "assistant",
        text: "Check experience",
        citations: [
          {
            id: "S001",
            label: "Terms",
            excerpt: "Two certificates",
            canOpen: true,
          },
        ],
        taskSuggestions: [
          {
            id: "R1",
            title: "Experience",
            description: "Verify two certificates",
            citationIds: ["S001"],
          },
        ],
      },
    ],
    source: {
      url: "https://example.com/private/source/ticket#page=4",
      page: 4,
    },
  });
  expect(parsed?.messages[0]?.citations?.[0]?.canOpen).toBe(true);
  expect(parsed?.messages[0]?.taskSuggestions?.[0]?.id).toBe("R1");
  expect(parsed?.source?.page).toBe(4);
  expect(
    parsePluginAssistantOpenRequest({
      title: "Tender",
      actionId: "chat",
      context: { id: "x" },
      taskCollection: "secop_application_tasks",
    })?.taskCollection,
  ).toBe("secop_application_tasks");
});

it("rejects unsafe source URLs and malformed task suggestions", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.com/a",
    "https://user:secret@example.com/a",
  ]) {
    expect(
      parsePluginAssistantResponse({
        revision: 0,
        messages: [],
        source: { url },
      }),
    ).toBeNull();
  }
  expect(
    parsePluginAssistantResponse({
      revision: 0,
      messages: [
        {
          id: "a",
          role: "assistant",
          text: "x",
          taskSuggestions: [
            {
              id: "R1",
              title: "x",
              description: "x",
              citationIds: ["unknown"],
            },
          ],
        },
      ],
    }),
  ).toBeNull();
  expect(
    parsePluginAssistantOpenRequest({
      title: "Tender",
      actionId: "chat",
      context: {},
      taskCollection: "../other",
    }),
  ).toBeNull();
});
