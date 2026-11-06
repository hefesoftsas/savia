import { expect, it } from "vitest";
import { createPluginEditorTypeScriptService } from "../plugin-editor-typescript-service";
import { pluginEditorTypeScriptLibraries } from "../plugin-editor-typescript-libraries";
import { pluginIdeDeclarations } from "../plugin-ide-declarations";

const files = {
  "/workspace/main.tsx": `const root = createRoot(document.createElement("div"));
root.`,
};

const service = () =>
  createPluginEditorTypeScriptService({
    files,
    libraries: pluginEditorTypeScriptLibraries,
  });

const namesAtEnd = (
  languageService: ReturnType<typeof service>,
  fileName: string,
  source: string,
) =>
  languageService.complete(fileName, source.length).map((entry) => entry.name);

it("completes the IDE React hooks and createElement global from ambient declarations", () => {
  const languageService = service();
  const source = "React.";
  languageService.updateFiles({ "/workspace/main.tsx": source });

  const completions = namesAtEnd(
    languageService,
    "/workspace/main.tsx",
    source,
  );
  expect(completions).toEqual(
    expect.arrayContaining([
      "useState",
      "useEffect",
      "useMemo",
      "createElement",
    ]),
  );
  expect(pluginIdeDeclarations).toContain("declare const React");
});

it("completes render and unmount on createRoot's returned value", () => {
  const languageService = service();
  const source =
    'const root = createRoot(document.createElement("div"));\nroot.';
  languageService.updateFiles({ "/workspace/main.tsx": source });

  const completions = namesAtEnd(
    languageService,
    "/workspace/main.tsx",
    source,
  );
  expect(completions).toEqual(expect.arrayContaining(["render", "unmount"]));
});

it("uses updated snapshots and keeps ambient and library files out of the caller map", () => {
  const languageService = service();
  const source = "const currentValue = { newerProperty: true };\ncurrentValue.";
  const updatedFiles = { "/workspace/main.tsx": source };
  languageService.updateFiles(updatedFiles);

  const completions = namesAtEnd(
    languageService,
    "/workspace/main.tsx",
    source,
  );
  expect(completions).toContain("newerProperty");
  expect(updatedFiles).toEqual({ "/workspace/main.tsx": source });
  expect(Object.keys(updatedFiles)).toEqual(["/workspace/main.tsx"]);
});

it("provides modern JavaScript Promise and Map members from bundled libraries", () => {
  const languageService = service();
  for (const [source, expected] of [
    ["Promise.", ["all", "resolve", "reject"]],
    ["const items = new Map<string, number>();\nitems.", ["get", "set", "has"]],
  ] as const) {
    languageService.updateFiles({ "main.tsx": source });
    expect(namesAtEnd(languageService, "main.tsx", source)).toEqual(
      expect.arrayContaining(expected),
    );
  }
});
