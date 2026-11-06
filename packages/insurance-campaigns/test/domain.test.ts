import { it, expect } from "vitest";
import { recipients } from "../src/domain";
it("excludes absent consent, suppressed, invalid emails and duplicate recipients", () => {
  const valid = {
    id: "one",
    email: "a@example.com",
    marketing_consent: true,
    marketing_suppressed: false,
    segment: "renewal",
  };
  expect(
    recipients(
      [
        valid,
        { ...valid, id: "two" },
        { ...valid, email: "b@example.com", marketing_consent: false },
        { ...valid, email: "c@example.com", marketing_suppressed: true },
        { id: "unknown", email: "d@example.com" },
      ],
      "renewal",
    ),
  ).toEqual([valid]);
});
