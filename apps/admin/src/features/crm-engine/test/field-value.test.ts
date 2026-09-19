import { expect, it } from "vitest";
import { formatFieldValue } from "../field-value";
it("keeps date-only values on the same calendar day", () => {
  expect(
    formatFieldValue(
      "2026-09-19",
      { type: "DateControl", label: "Day" },
      "en-US",
    ),
  ).toBe("9/19/2026");
});
it("renders option labels, false and zero without treating them as empty", () => {
  expect(formatFieldValue(false, { type: "Toggle", label: "Active" })).toBe(
    "No",
  );
  expect(formatFieldValue(0, { type: "Number", label: "Count" })).toBe("0");
  expect(
    formatFieldValue(["a", "b"], {
      type: "Dropdown",
      label: "Options",
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    }),
  ).toBe("Alpha, Beta");
});
it("formats temporal values and missing currency consistently", () => {
  expect(formatFieldValue("09:30", { type: "Time", label: "Time" })).toBe(
    "09:30",
  );
  expect(formatFieldValue(null, { type: "Currency", label: "Cost" })).toBe("—");
  const value = "2026-09-19T14:30:00Z";
  expect(
    formatFieldValue(value, { type: "DateTime", label: "Start" }, "en-US"),
  ).toBe(
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value)),
  );
});
