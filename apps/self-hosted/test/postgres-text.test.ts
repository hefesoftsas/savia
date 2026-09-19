import { expect, it } from "vitest";
import { assertPostgresText } from "../src/postgres/text-values";
it("rejects unsupported Unicode before persistence without rejecting literal escape text", () => {
  for (const value of [
    "a\0b",
    "\ud800",
    JSON.stringify({ x: "a\0b" }),
    JSON.stringify({ x: ["\ud800"] }),
    '{"x":"\\u0000","x":"safe"}',
    '{"x":"\\ud800","x":"safe"}',
  ])
    expect(() => assertPostgresText(value)).toThrow(/Unicode/);
  for (const value of [
    "normal",
    "😀",
    JSON.stringify({ x: "\\u0000" }),
    '{"x":"\\ud83d\\ude00"}',
  ])
    expect(() => assertPostgresText(value)).not.toThrow();
});
