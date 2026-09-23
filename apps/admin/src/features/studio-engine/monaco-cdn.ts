const MONACO_VERSION = "0.52.2";
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

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

export function resolveMonacoTheme() {
  return document.documentElement.classList.contains("dark") ? "vs-dark" : "vs";
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
