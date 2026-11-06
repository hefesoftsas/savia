import { describe, expect, it } from "vitest";
import { parsePageContent } from "../src/pages/service";
import { requiredOAuthScope } from "../src/auth/oauth-resource";

describe("personal ticket summary Pages block", () => {
  it("round-trips configuration without storing provider data", () => {
    const blocks = [
      {
        type: "ticket_summary",
        id: "summary",
        ticketSummaryConfig: {
          project: "OPS",
          statuses: ["Peer Review", "QA"],
        },
        children: [{ text: "" }],
      },
    ];
    expect(parsePageContent(blocks)).toEqual(blocks);
    expect(
      parsePageContent([{ type: "ticket_summary", children: [{ text: "" }] }]),
    ).toHaveLength(1);
  });
  it("rejects embedded results and identity overrides", () => {
    for (const extra of [
      { tickets: [] },
      { ticketSummaryConfig: { principalId: "other" } },
      { ticketSummaryConfig: { statuses: [] } },
      { name: "Cached private summary" },
      { children: [{ text: "private Jira comment" }] },
    ]) {
      expect(() =>
        parsePageContent([
          { type: "ticket_summary", children: [{ text: "" }], ...extra },
        ]),
      ).toThrow();
    }
  });
  it("does not accept summary configuration on ordinary page blocks", () => {
    expect(() =>
      parsePageContent([
        { type: "p", ticketSummaryConfig: {}, children: [{ text: "" }] },
      ]),
    ).toThrow();
  });
  it("requires only read scope for the summary read operation", () => {
    expect(
      requiredOAuthScope(
        new Request(
          "https://savia.test/v1/personal-integrations/ticket-summary",
          { method: "POST" },
        ),
      ),
    ).toBe("savia.api.read");
  });
});
