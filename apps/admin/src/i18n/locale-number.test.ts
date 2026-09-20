import { expect, it } from "vitest";
import { parseLocalizedNumber } from "./locale-number";
it.each([
  ["en-US", "1,234", 1234],
  ["en-US", "1,234.50", 1234.5],
  ["es-CO", "1.234", 1234],
  ["pt-BR", "1.234,50", 1234.5],
  ["es-CO", "-0,25", -0.25],
  ["en-US", "0.00", 0],
  ["pt-BR", "", null],
  ["es-CO", "1500.5", null],
  ["en-US", "1,23", null],
  ["en-US", "12oops", null],
  ["pt-BR", "1,2,3", null],
])("parses %s input %s without changing magnitude", (locale, text, number) => {
  expect(parseLocalizedNumber(String(text), String(locale))).toBe(number);
});
