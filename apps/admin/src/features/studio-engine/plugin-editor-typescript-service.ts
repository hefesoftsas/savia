import ts from "typescript";
import { pluginIdeDeclarations } from "./plugin-ide-declarations";

export type PluginEditorFileMap = Readonly<Record<string, string>>;

export type PluginEditorCompletionEntry = {
  name: string;
  kind: string;
  insertText?: string;
  sortText: string;
};

type ScriptRecord = {
  text: string;
  version: number;
  snapshot: ts.IScriptSnapshot;
};

const workspaceRoot = "/workspace";
const ambientPath = `${workspaceRoot}/savia-globals.d.ts`;

export function normalizePluginEditorPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments[0] === "workspace") segments.shift();
  const normalized = `/${segments.join("/")}`;
  return normalized === "/" ? workspaceRoot : `${workspaceRoot}${normalized}`;
}

export function createPluginEditorTypeScriptService(options: {
  files?: PluginEditorFileMap;
  libraries?: PluginEditorFileMap;
}) {
  const records = new Map<string, ScriptRecord>();
  const libraryPaths = new Set<string>();

  const normalizedLibraries = new Map<string, string>();
  for (const [path, text] of Object.entries(options.libraries ?? {})) {
    const normalizedPath = normalizePluginEditorPath(path);
    normalizedLibraries.set(normalizedPath, text);
    libraryPaths.add(normalizedPath);
  }

  const updateFiles = (files: PluginEditorFileMap) => {
    const next = new Map<string, string>();
    for (const [path, text] of Object.entries(files)) {
      const normalizedPath = normalizePluginEditorPath(path);
      if (
        /\.(?:tsx?|jsx?)$/i.test(normalizedPath) &&
        normalizedPath !== ambientPath &&
        !libraryPaths.has(normalizedPath)
      ) {
        next.set(normalizedPath, text);
      }
    }

    for (const path of [...records.keys()]) {
      if (!next.has(path) && path !== ambientPath && !libraryPaths.has(path)) {
        records.delete(path);
      }
    }

    const allFiles = new Map(normalizedLibraries);
    allFiles.set(ambientPath, pluginIdeDeclarations);
    for (const [path, text] of next) allFiles.set(path, text);

    for (const [path, text] of allFiles) {
      const previous = records.get(path);
      if (previous?.text === text) continue;
      records.set(path, {
        text,
        version: (previous?.version ?? 0) + 1,
        snapshot: ts.ScriptSnapshot.fromString(text),
      });
    }
  };

  updateFiles(options.files ?? {});

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.React,
      allowJs: true,
      noEmit: true,
      skipLibCheck: true,
      noLib: true,
      strict: true,
    }),
    getCurrentDirectory: () => workspaceRoot,
    getDefaultLibFileName: () => `${workspaceRoot}/lib.es5.d.ts`,
    getScriptFileNames: () => [...records.keys()],
    getScriptVersion: (fileName) => String(records.get(fileName)?.version ?? 0),
    getScriptSnapshot: (fileName) => records.get(fileName)?.snapshot,
    fileExists: (fileName) => records.has(normalizePluginEditorPath(fileName)),
    readFile: (fileName) =>
      records.get(normalizePluginEditorPath(fileName))?.text,
    readDirectory: () => [],
  };

  const languageService = ts.createLanguageService(host);

  return {
    updateFiles,
    complete(fileName: string, offset: number): PluginEditorCompletionEntry[] {
      const path = normalizePluginEditorPath(fileName);
      const source = records.get(path);
      if (!source) return [];
      const position = Math.max(0, Math.min(offset, source.text.length));
      const completions = languageService.getCompletionsAtPosition(
        path,
        position,
        { includeInsertTextCompletions: true },
      );
      return (completions?.entries ?? []).map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        ...(typeof entry.insertText === "string"
          ? { insertText: entry.insertText }
          : {}),
        sortText: entry.sortText,
      }));
    },
    dispose() {
      languageService.dispose();
      records.clear();
    },
  };
}
