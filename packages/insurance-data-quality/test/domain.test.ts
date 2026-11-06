import { expect, it } from "vitest";
import { parseCsv, duplicateGroups, planImport } from "../src/domain";
it("parses quoted commas/newlines and rejects malformed rows", () => {
  expect(
    parseCsv(
      'name,email\r\n"A, B",a@example.test\r\n"Line\nTwo",b@example.test',
    ),
  ).toEqual([
    { name: "A, B", email: "a@example.test" },
    { name: "Line\nTwo", email: "b@example.test" },
  ]);
  expect(() => parseCsv("name,name\na,b")).toThrow();
  expect(() => parseCsv('name,email\n"unterminated,a')).toThrow();
});
it("groups duplicates without changing source data", () => {
  expect(
    duplicateGroups(
      [
        { id: "1", email: " A@B.test " },
        { id: "2", email: "a@b.test" },
        { id: "3", email: "" },
      ],
      "email",
    ),
  ).toEqual([["1", "2"]]);
});
it("validates conversion and skips existing unique keys", () => {
  const fields = {
    name: { type: "Textbox", required: true },
    amount: { type: "Number" },
    key: { type: "Textbox", config: { unique: true } },
  };
  const plan = planImport(
    [
      { name: "A", amount: "12.3", key: "a" },
      { name: "B", amount: "oops", key: "b" },
      { name: "C", key: "x" },
    ],
    fields as any,
    [{ id: "old", key: "x" }],
    "key",
  );
  expect(plan.map((r) => r.status)).toEqual(["ready", "invalid", "exists"]);
  expect(plan[0].data.amount).toBe(12.3);
});
it("rejects lossy numeric identifiers before matching existing rows", () => {
  const plan = planImport(
    [{ key: "9007199254740993" }],
    { key: { type: "Number", config: { unique: true } } } as any,
    [{ id: "old", key: 9007199254740992 }],
    "key",
  );
  expect(plan[0].status).toBe("invalid");
});
