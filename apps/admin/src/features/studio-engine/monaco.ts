import "monaco-editor/min/vs/editor/editor.main.css";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { PluginIdeTheme } from "./plugin-ide-theme";

export type MonacoModule = typeof Monaco;

export type MonacoEditorInstance = {
  getValue: () => string;
  setValue: (value: string) => void;
  dispose: () => void;
  onDidChangeModelContent: (listener: () => void) => void;
  layout: () => void;
  updateOptions: (options: Record<string, unknown>) => void;
};

const SAVIA_THEME_NAME = "savia-plugin-ide-theme";

let monacoPromise: Promise<MonacoModule> | null = null;

async function loadBundledMonaco(): Promise<MonacoModule> {
  // The package root resolves to the AMD loader; the ESM entry below is the
  // documented Vite-compatible build (same module monacopilot binds to).
  const monaco = await import("monaco-editor/esm/vs/editor/editor.api");
  const [
    { default: EditorWorker },
    { default: JsonWorker },
    { default: TsWorker },
  ] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
  ]);
  // Workers are bundled by Vite (?worker) and registered before any editor
  // is created. Kept off the static import graph so unit tests can import
  // this module without a worker-capable environment.
  (globalThis as unknown as Record<string, unknown>).MonacoEnvironment = {
    getWorker(_moduleId: unknown, label: string) {
      if (label === "json") return new JsonWorker();
      if (label === "typescript" || label === "javascript")
        return new TsWorker();
      return new EditorWorker();
    },
  };
  // Editor API has no language services by itself. These contributions add
  // the language defaults accessed by MonacoCodeEditor and enable JSON/TS
  // diagnostics and completion in the editor model.
  await Promise.all([
    import("monaco-editor/esm/vs/basic-languages/css/css.contribution"),
    import("monaco-editor/esm/vs/language/json/monaco.contribution"),
    import("monaco-editor/esm/vs/language/typescript/monaco.contribution"),
  ]);
  return monaco;
}

export function resolveMonacoTheme(theme?: PluginIdeTheme) {
  if (theme) return SAVIA_THEME_NAME;
  return document.documentElement.classList.contains("dark") ? "vs-dark" : "vs";
}

export function applyMonacoTheme(monaco: MonacoModule, theme: PluginIdeTheme) {
  monaco.editor.defineTheme(SAVIA_THEME_NAME, {
    base: theme.isDark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": theme.background,
      "editor.foreground": theme.foreground,
      "editorLineNumber.foreground": theme.mutedForeground,
      "editorLineNumber.activeForeground": theme.foreground,
      "editorCursor.foreground": theme.primary,
      "editor.selectionBackground": `${theme.primary}55`,
      "editor.inactiveSelectionBackground": `${theme.primary}33`,
      "editor.lineHighlightBackground": `${theme.muted}80`,
      "editorGutter.background": theme.background,
      "editorWidget.background": theme.muted,
      "editorWidget.border": theme.border,
    },
  });
  monaco.editor.setTheme(SAVIA_THEME_NAME);
}

export function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = loadBundledMonaco().catch((error: unknown) => {
      // A transient bundling or parse failure must not poison every editor
      // for the rest of the session; the next mount retries the import.
      monacoPromise = null;
      throw error;
    });
  }
  return monacoPromise;
}
