import { expect, it } from "vitest";
import { recordOptionLabel } from "../record-option-label";
it("resolves remote stage and pipeline labels while preserving unknown values", () => {
  const record = { dealstage: "1430498731", pipeline: "default" };
  expect(recordOptionLabel(record.dealstage, [{ value: "1430498731", label: "Negociación" }])).toBe("Negociación");
  expect(recordOptionLabel(record.pipeline, [{ value: "default", label: "Ventas" }])).toBe("Ventas");
  expect(recordOptionLabel("unknown", [{ value: "default", label: "Ventas" }])).toBe("unknown");
  expect(record).toEqual({ dealstage: "1430498731", pipeline: "default" });
});
it("handles numeric and multiple option values", () => {
  expect(recordOptionLabel([1, "missing"], [{ value: "1", label: "Uno" }])).toEqual(["Uno", "missing"]);
  expect(recordOptionLabel(null, [])).toBeNull();
});
