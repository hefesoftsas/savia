import { expect, it } from "vitest";
import { summarize, customerRecords } from "../src/domain";
it("uses exact cents and keeps invalid figures visible", () => {
  const result = summarize(
    {
      insurance_receivables: [
        { id: "1", amount: 0.1, paid: 0 },
        { id: "2", amount: 0.2, paid: 0 },
        { id: "3", amount: "bad" },
      ],
    },
    "2026-09-19",
  );
  expect(result.receivableCents).toBe(30);
  expect(result.invalidAmounts).toBe(1);
});
it("links by native customer ids, never matching customer names", () => {
  expect(
    customerRecords(
      [
        { id: "a", customer_id: "c" },
        { id: "b", customer: "c" },
        { id: "d", cliente: "c" },
      ],
      "c",
    ).map((r) => r.id),
  ).toEqual(["a", "d"]);
});
it("uses each worklist deadline and ignores completed activities", () => {
  const result = summarize(
    {
      insurance_activities: [
        { id: "a", stage: "completed", due_date: "2026-09-01" },
      ],
      insurance_renewals: [
        { id: "r", stage: "pending", expiry_date: "2026-09-01" },
      ],
      insurance_claims: [
        { id: "c", stage: "reported", next_follow_up: "2026-09-02" },
      ],
      insurance_opportunities: [
        { id: "o", stage: "won", target_date: "2026-09-02" },
      ],
      insurance_receivables: [
        {
          id: "p",
          amount: 1,
          paid: 1,
          stage: "pending",
          due_date: "2026-09-01",
        },
      ],
    },
    "2026-09-19",
  );
  expect(result.overdue).toBe(2);
});
