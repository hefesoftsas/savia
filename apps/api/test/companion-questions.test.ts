import { describe, expect, it } from "vitest";
import { CompanionService } from "../src/companion/service";
const config = {
  apiKey: "server-only",
  model: "test/chat",
  summaryModel: "test/summary",
};
describe("recording questions", () => {
  it("uses only the supplied saved transcript with the configured summary model", async () => {
    let sent: any;
    const service = new CompanionService({
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "Ana reviews audio tomorrow.",
                  insufficientEvidence: false,
                }),
              },
            },
          ],
        });
      },
    });
    expect(
      await service.answer(
        config,
        "Ana reviews audio tomorrow. Budget undecided.",
        { question: "Who reviews audio?", consent: true },
      ),
    ).toEqual({
      answer: "Ana reviews audio tomorrow.",
      insufficientEvidence: false,
    });
    expect(sent.model).toBe("test/summary");
    expect(JSON.parse(sent.messages[1].content)).toEqual({
      transcript: "Ana reviews audio tomorrow. Budget undecided.",
      question: "Who reviews audio?",
    });
  });
  it("preserves insufficient evidence and rejects malformed provider output", async () => {
    let output: unknown = {
      answer: "The recording does not specify a budget.",
      insufficientEvidence: true,
    };
    const service = new CompanionService({
      fetch: async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify(output) } }],
        }),
    });
    expect(
      await service.answer(config, "Budget undecided.", {
        question: "What is the budget?",
        consent: true,
      }),
    ).toHaveProperty("insufficientEvidence", true);
    output = { answer: "Invented", timestamps: [123] };
    await expect(
      service.answer(config, "Budget undecided.", {
        question: "Budget?",
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
  });
  it("requires transcript, bounded question and explicit consent before provider calls", async () => {
    let calls = 0;
    const service = new CompanionService({
      fetch: async () => {
        calls++;
        return Response.json({});
      },
    });
    for (const [transcript, question, consent] of [
      ["", "Who?", true],
      ["Evidence", "", true],
      ["Evidence", "x".repeat(2001), true],
      ["Evidence", "Who?", false],
    ] as const) {
      await expect(
        service.answer(config, transcript, { question, consent } as any),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_REQUEST|TRANSCRIPT_REQUIRED/),
      });
    }
    expect(calls).toBe(0);
  });
});
