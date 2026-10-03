import { expect, it } from "vitest";
import { makePageExcerpt } from "../src/pages/excerpt";

it("normalizes whitespace and centers a bounded excerpt around a later query match", () => {
  const source = `${"early ".repeat(100)} Needle\n\nfound ${"late ".repeat(100)}`;
  const excerpt = makePageExcerpt(source, "needle");

  expect(excerpt).toBeDefined();
  expect(excerpt!.length).toBeLessThanOrEqual(360);
  expect(excerpt).toContain("Needle found");
  expect(excerpt!.startsWith("…")).toBe(true);
  expect(excerpt!.endsWith("…")).toBe(true);
});

it("treats query punctuation as literal text and omits excerpts without a match", () => {
  expect(makePageExcerpt("a [x]%_\\b literal", "[x]%_\\b")).toBe(
    "a [x]%_\\b literal",
  );
  expect(makePageExcerpt("some unrelated text", "missing")).toBeUndefined();
});

it("can return bounded semantic context when there is no exact query phrase", () => {
  const excerpt = makePageExcerpt("Fresh authorized page content", "concept", {
    requireMatch: false,
  });
  expect(excerpt).toBe("Fresh authorized page content");
});

it("keeps a late match close to the excerpt start for compact mobile results", () => {
  const excerpt = makePageExcerpt(
    `${"prefix ".repeat(100)}late target`,
    "target",
  );

  expect(excerpt).toBeDefined();
  expect(excerpt!.indexOf("target")).toBeLessThanOrEqual(61);
  expect(excerpt!.startsWith("…")).toBe(true);
});
