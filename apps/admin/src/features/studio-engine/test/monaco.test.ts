// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadMonaco, resolveMonacoTheme } from "../monaco";

// Monaco's full editor contribution set checks a deprecated browser API that
// jsdom does not provide; real browsers expose it.
if (!document.queryCommandSupported)
  Object.defineProperty(document, "queryCommandSupported", {
    configurable: true,
    value: () => false,
  });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => ({}),
});

describe("monaco loader", () => {
  it("loads the language services used by the plugin editor", async () => {
    const monaco = await loadMonaco();

    expect(
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions,
    ).toBeTypeOf("function");
    expect(monaco.languages.json.jsonDefaults.setDiagnosticsOptions).toBeTypeOf(
      "function",
    );
  }, 60000);

  it("tokenizes plugin languages and registers core editor interactions", async () => {
    const monaco = await loadMonaco();
    const languages = monaco.languages.getLanguages().map(({ id }) => id);

    expect(languages).toEqual(
      expect.arrayContaining(["html", "javascript", "typescript"]),
    );

    for (const [language, source, expected] of [
      [
        "typescript",
        'const answer = "ready"; // note',
        ["keyword", "string", "comment"],
      ],
      [
        "javascript",
        'const answer = "ready"; // note',
        ["keyword", "string", "comment"],
      ],
      [
        "html",
        '<div class="ready">note</div>',
        ["tag", "attribute.name", "attribute.value"],
      ],
    ] as const) {
      await monaco.editor.colorize(source, language, { tabSize: 2 });
      const tokens = monaco.editor
        .tokenize(source, language)[0]
        .map(({ type }) => type);
      for (const token of expected)
        expect(
          tokens.some((type) => type.includes(token)),
          `${language} should tokenize ${token}: ${tokens.join(", ")}`,
        ).toBe(true);
    }

    const node = document.createElement("div");
    document.body.append(node);
    const editor = monaco.editor.create(node, {
      value: "const answer = 42;",
      language: "typescript",
      automaticLayout: true,
    });
    try {
      for (const id of [
        "editor.contrib.findController",
        "editor.contrib.folding",
        "editor.contrib.bracketMatchingController",
        "editor.contrib.suggestController",
      ])
        expect(editor.getContribution(id)).toBeTruthy();
    } finally {
      editor.dispose();
      node.remove();
    }
  }, 60000);

  it("maps document theme to monaco themes", () => {
    document.documentElement.classList.remove("dark");
    expect(resolveMonacoTheme()).toBe("vs");
    document.documentElement.classList.add("dark");
    expect(resolveMonacoTheme()).toBe("vs-dark");
  });
});
