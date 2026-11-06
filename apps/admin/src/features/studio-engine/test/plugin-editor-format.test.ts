import { describe, expect, it } from "vitest";
import { formatPluginDocument } from "../plugin-editor-format";

describe("verified formatter", () => {
  it("formats TSX without changing a translation value", async () => {
    expect(
      await formatPluginDocument(
        'const C=()=> <p>{"Changed 2"}</p>',
        "typescriptreact",
      ),
    ).toBe('const C = () => <p>{"Changed 2"}</p>;\n');
  });
  it("formats JSON and rejects unsupported languages", async () => {
    expect(await formatPluginDocument('{"a":1}', "json")).toBe('{ "a": 1 }\n');
    await expect(formatPluginDocument("hello", "binary")).rejects.toThrow(
      "Unsupported",
    );
  });
});
