// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadMonaco, resolveMonacoTheme } from "../monaco";

describe("monaco loader", () => {
  it("loads the language services used by the plugin editor", async () => {
    const monaco = await loadMonaco();

    expect(monaco.languages.typescript.typescriptDefaults.setCompilerOptions)
      .toBeTypeOf("function");
    expect(monaco.languages.json.jsonDefaults.setDiagnosticsOptions).toBeTypeOf(
      "function",
    );
  }, 60000);

  it("maps document theme to monaco themes", () => {
    document.documentElement.classList.remove("dark");
    expect(resolveMonacoTheme()).toBe("vs");
    document.documentElement.classList.add("dark");
    expect(resolveMonacoTheme()).toBe("vs-dark");
  });
});
