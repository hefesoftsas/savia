import { describe, expect, it } from "vitest";
import { coerceSaviaFieldValue, parseValidSaviaJson, saviaFieldControl, updateSaviaFieldMap } from "./savia-field-inputs";

describe("Savia field editor metadata", () => {
  it("maps Savia numeric, select, and boolean fields to useful controls", () => {
    expect(coerceSaviaFieldValue({ name: "amount", label: "Amount", type: "Number", required: true, readOnly: false }, "42")).toBe(42);
    expect(saviaFieldControl({ name: "state", label: "State", type: "Dropdown", required: false, readOnly: false, options: ["Open", "Closed"] })).toEqual({ kind: "select", options: [{ value: "Open", label: "Open" }, { value: "Closed", label: "Closed" }] });
    expect(coerceSaviaFieldValue({ name: "done", label: "Done", type: "Checkbox", required: false, readOnly: false }, true)).toBe(true);
  });
  it("removes cleared optional values and never turns an empty number into zero", () => {
    const field = { name: "amount", label: "Amount", type: "Number", required: false, readOnly: false };
    expect(updateSaviaFieldMap({ amount: 12, other: true }, field, "")).toEqual({ other: true });
    expect(coerceSaviaFieldValue(field, "")).toBeNull();
  });
  it("commits valid JSON drafts and leaves invalid drafts uncommitted", () => {
    expect(parseValidSaviaJson('{"ok":true}')).toEqual({ valid: true, value: { ok: true } });
    expect(parseValidSaviaJson("{")).toEqual({ valid: false });
  });
});
