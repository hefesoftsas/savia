import type { PluginIdeTheme } from "./plugin-ide-theme";

const MONACO_VERSION = "0.52.2";
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
const SAVIA_THEME_NAME = "savia-plugin-ide-theme";

type MonacoModule = {
  Uri: { parse: (value: string) => unknown };
  languages: {
    typescript: {
      typescriptDefaults: {
        setCompilerOptions: (options: Record<string, unknown>) => void;
        addExtraLib: (source: string, path: string) => { dispose: () => void };
      };
    };
  };
  editor: {
    defineTheme: (themeName: string, data: Record<string, unknown>) => void;
    setTheme: (themeName: string) => void;
    createModel: (
      value: string,
      language: string,
      uri: unknown,
    ) => { dispose: () => void };
    create: (
      dom: HTMLElement,
      options: Record<string, unknown>,
    ) => MonacoEditorInstance;
  };
};

export type MonacoEditorInstance = {
  getValue: () => string;
  setValue: (value: string) => void;
  dispose: () => void;
  onDidChangeModelContent: (listener: () => void) => void;
  layout: () => void;
  updateOptions: (options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    require?: {
      config: (options: { paths: { vs: string } }) => void;
      (modules: string[], callback: () => void): void;
    };
    monaco?: MonacoModule;
  }
}

let monacoPromise: Promise<MonacoModule> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(src)), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });
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

export function loadMonacoFromCdn() {
  if (window.monaco) return Promise.resolve(window.monaco);
  if (!monacoPromise) {
    monacoPromise = loadScript(`${MONACO_BASE}/loader.js`).then(
      () =>
        new Promise<MonacoModule>((resolve, reject) => {
          if (!window.require) {
            reject(new Error("Monaco loader unavailable"));
            return;
          }
          window.require.config({ paths: { vs: MONACO_BASE } });
          window.require(["vs/editor/editor.main"], () => {
            if (!window.monaco) {
              reject(new Error("Monaco editor unavailable"));
              return;
            }
            resolve(window.monaco);
          });
        }),
    );
  }
  return monacoPromise;
}
