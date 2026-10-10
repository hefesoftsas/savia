import { expect, it } from "vitest";
import { searchPluginProjectFiles } from "../plugin-project-search";

it("returns every literal match with one-based CRLF-aware source positions", () => {
  const result = searchPluginProjectFiles(
    {
      "src/z.ts": "First\r\nA+B\r\nxA+B",
      "src/a.ts": "A+B / a+b",
    },
    "a+b",
  );

  expect(result).toEqual({
    results: [
      {
        path: "src/a.ts",
        lineNumber: 1,
        column: 1,
        endColumn: 4,
        lineText: "A+B / a+b",
      },
      {
        path: "src/a.ts",
        lineNumber: 1,
        column: 7,
        endColumn: 10,
        lineText: "A+B / a+b",
      },
      {
        path: "src/z.ts",
        lineNumber: 2,
        column: 1,
        endColumn: 4,
        lineText: "A+B",
      },
      {
        path: "src/z.ts",
        lineNumber: 3,
        column: 2,
        endColumn: 5,
        lineText: "xA+B",
      },
    ],
    truncated: false,
  });
});

it("searches case-insensitively by default and preserves file and occurrence order", () => {
  const result = searchPluginProjectFiles(
    {
      "z.ts": "Needle needle",
      "a.ts": "NEEDLE\nneedle",
    },
    "needle",
  );

  expect(result.results).toEqual([
    {
      path: "a.ts",
      lineNumber: 1,
      column: 1,
      endColumn: 7,
      lineText: "NEEDLE",
    },
    {
      path: "a.ts",
      lineNumber: 2,
      column: 1,
      endColumn: 7,
      lineText: "needle",
    },
    {
      path: "z.ts",
      lineNumber: 1,
      column: 1,
      endColumn: 7,
      lineText: "Needle needle",
    },
    {
      path: "z.ts",
      lineNumber: 1,
      column: 8,
      endColumn: 14,
      lineText: "Needle needle",
    },
  ]);
});

it("reports original UTF-16 columns when case folding would expand earlier text", () => {
  expect(
    searchPluginProjectFiles({ "unicode.ts": "İ needle" }, "needle").results,
  ).toEqual([
    {
      path: "unicode.ts",
      lineNumber: 1,
      column: 3,
      endColumn: 9,
      lineText: "İ needle",
    },
  ]);
});

it("returns no matches for an empty query and skips binary and base64 paths", () => {
  const files = {
    "src/main.ts": "needle",
    "assets/logo.png": "needle",
    "assets/banner.webp": "needle",
    "assets/blob.base64": "needle",
  };
  expect(searchPluginProjectFiles(files, "").results).toEqual([]);
  expect(searchPluginProjectFiles(files, "needle").results).toEqual([
    {
      path: "src/main.ts",
      lineNumber: 1,
      column: 1,
      endColumn: 7,
      lineText: "needle",
    },
  ]);
});

it("caps results at 500 and reports truncation only when more matches exist", () => {
  const result = searchPluginProjectFiles(
    { "many.ts": Array.from({ length: 501 }, () => "x").join("\n") },
    "x",
  );
  expect(result.results).toHaveLength(500);
  expect(result.results.at(-1)).toMatchObject({ lineNumber: 500 });
  expect(result.truncated).toBe(true);
  expect(searchPluginProjectFiles({ "one.ts": "x" }, "x").truncated).toBe(
    false,
  );
});
