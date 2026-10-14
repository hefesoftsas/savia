import { expect, it, vi } from "vitest";
import { completeWithOpenRouter } from "../src/whatsapp/quote-presentation";
import { analyzeQuoteReport } from "../src/whatsapp/quote-analysis";

it("sends a strict nullable recommendation schema through the real OpenRouter adapter", async () => {
  let body: Record<string, any> | undefined;
  const wire = {
    proposals: [{ id: "offer-1", explanation: "Prima verificada de $1.000." }],
    suggestion: "Compara las condiciones informadas.",
    preferredProposalId: null,
    limitations: [],
  };
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        id: "test-completion",
        model: "provider/test",
        object: "chat.completion",
        created: 1,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(wire) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  try {
    const result = await completeWithOpenRouter({
      apiKey: "test-only",
      model: "provider/test",
      system: "Analyze verified facts only.",
      prompt: "Verified offer.",
      maxOutputTokens: 980,
      signal: new AbortController().signal,
    });
    expect(body?.response_format?.type).toBe("json_schema");
    expect(body?.response_format?.json_schema?.strict).toBe(true);
    const schema = body?.response_format?.json_schema?.schema;
    expect(schema?.required).toContain("preferredProposalId");
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.properties?.preferredProposalId).toEqual(
      expect.objectContaining({
        anyOf: expect.arrayContaining([
          expect.objectContaining({ type: "null" }),
        ]),
      }),
    );
    expect(body?.provider?.require_parameters).toBe(true);
    expect(JSON.parse(result.text)).not.toHaveProperty("preferredProposalId");
    expect(JSON.parse(result.text).proposals).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([
  { text: '{"proposals":42}', finish: "stop", outcome: "invalid_schema" },
  { text: '{"proposals":', finish: "length", outcome: "truncated_output" },
])(
  "preserves $outcome classification after native output rejection",
  async ({ text, finish, outcome }) => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            id: "test-completion",
            model: "provider/test",
            object: "chat.completion",
            created: 1,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: text },
                finish_reason: finish,
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    try {
      const completion = await completeWithOpenRouter({
        apiKey: "test-only",
        model: "provider/test",
        system: "Analyze verified facts only.",
        prompt: "Verified offer.",
        maxOutputTokens: 980,
        signal: new AbortController().signal,
      });
      expect(completion).toMatchObject({
        text,
        finishReason: finish,
        outputTokens: 50,
      });
      const onOutcome = vi.fn();
      await analyzeQuoteReport(
        {
          version: 1,
          reference: "COT-20261007-ABCDEF12",
          createdAt: "2026-10-07T12:00:00.000Z",
          proposals: [
            {
              id: "offer-1",
              provider: "Carrier",
              product: "Plan",
              state: "priced",
              premium: 1000,
              currency: "COP",
            },
          ],
        },
        async () => completion,
        { onOutcome },
      );
      expect(onOutcome).toHaveBeenCalledWith(outcome);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
