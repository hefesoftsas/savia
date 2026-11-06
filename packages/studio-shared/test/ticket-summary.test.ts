import { describe, expect, it } from "vitest";
import { ticketSummaryConfigSchema } from "../src/ticket-summary";

describe("personal ticket summary configuration", () => {
  it("accepts defaults and project-specific status labels", () => {
    expect(ticketSummaryConfigSchema.parse({})).toEqual({});
    expect(
      ticketSummaryConfigSchema.parse({
        project: "OPS",
        statuses: ["Peer Review", "QA / Acceptance"],
      }),
    ).toEqual({ project: "OPS", statuses: ["Peer Review", "QA / Acceptance"] });
  });
  it("rejects identity overrides, arbitrary JQL and empty or excessive filters", () => {
    for (const input of [
      { principalId: "other" },
      { jql: "assignee = other" },
      { project: "OPS OR assignee = other" },
      { statuses: [] },
      { statuses: Array(21).fill("QA") },
    ]) {
      expect(ticketSummaryConfigSchema.safeParse(input).success).toBe(false);
    }
  });
});
