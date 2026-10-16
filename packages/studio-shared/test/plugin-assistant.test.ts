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
