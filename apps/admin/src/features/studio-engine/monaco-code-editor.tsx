import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import type { editor as MonacoEditorNamespace } from "monaco-editor/esm/vs/editor/editor.api";
import {
  applyMonacoTheme,
  loadMonaco,
  resolveMonacoTheme,
  type MonacoEditorInstance,
} from "./monaco";
import { observePluginIdeTheme, readPluginIdeTheme } from "./plugin-ide-theme";

function readMonacoFontFamily(element: Element) {
  let configured = "";
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    configured = window
      .getComputedStyle(current)
      .getPropertyValue("--font-mono")
      .trim();
    if (configured) break;
  }
  return configured &&
    configured.length <= 160 &&
    /^[\w\s,'"-]+$/.test(configured)
    ? configured
    : "monospace";
}

export function MonacoCodeEditor({
  value,
  onChange,
  language,
  height = 280,
  placeholder,
  ariaLabel,
  readOnly = false,
  contextDeclarations,
  inlineCompletion,
}: {
  value: string;
  onChange: (value: string) => void;
  language: "html" | "javascript" | "typescript" | "json" | "css";
  readOnly?: boolean;
  contextDeclarations?: string;
  height?: number;
  placeholder?: string;
  ariaLabel: string;
  inlineCompletion?: {
    filename: string;
    fetchCompletion: (prefix: string, suffix: string) => Promise<string | null>;
  };
}) {
  const t = useMessages(recordsMessages);

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const inlineCompletionRef = useRef(inlineCompletion);
  inlineCompletionRef.current = inlineCompletion;
  const valueRef = useRef(value);
  valueRef.current = value;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const programmaticChange = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let disposed = false;
    let editor: MonacoEditorInstance | null = null;
    let stopThemeObservation: (() => void) | undefined;
    let stopInlineCompletion: (() => void) | undefined;
    let model: MonacoEditorNamespace.ITextModel | undefined;
    let declarations: { dispose: () => void } | undefined;

    loadMonaco()
      .then(async (monaco) => {
        if (disposed || !containerRef.current) return;
        if (language === "typescript") {
          monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            jsx: 2,
            target: 7,
            allowNonTsExtensions: true,
          });
          declarations =
            monaco.languages.typescript.typescriptDefaults.addExtraLib(
              contextDeclarations ??
                `
            interface ResultsProps {
              rows: { id: string; title: string; status: string; date: string; simulation: boolean; values: string[]; errors: string[]; response: unknown }[];
              columns: { label: string; pointer: string; format: "text" | "money" }[];
              disabled: boolean;
              load(id: string): void;
            }
            declare const React: { useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void]; Fragment: any; createElement: any };
          `,
              `file:///savia-editor-context-${crypto.randomUUID()}.d.ts`,
            );
        }
        model = monaco.editor.createModel(
          valueRef.current,
          language,
          monaco.Uri.parse(
            `inmemory://savia/editor-${crypto.randomUUID()}.${language === "typescript" ? "tsx" : language}`,
          ),
        );
        const themeRoot = containerRef.current.ownerDocument.documentElement;
        const initialTheme = readPluginIdeTheme(themeRoot);
        applyMonacoTheme(monaco, initialTheme);
        editor = monaco.editor.create(containerRef.current, {
          model,
          theme: resolveMonacoTheme(initialTheme),
          readOnly: readOnlyRef.current,
          folding: true,
          bracketPairColorization: { enabled: true },
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: readMonacoFontFamily(containerRef.current),
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 8, bottom: 8 },
          ariaLabel,
        });
        stopThemeObservation = observePluginIdeTheme(themeRoot, (nextTheme) => {
          applyMonacoTheme(monaco, nextTheme);
          editor?.updateOptions({
            fontFamily: readMonacoFontFamily(containerRef.current!),
          });
        });
        editorRef.current = editor;
        editor.onDidChangeModelContent(() => {
          if (!programmaticChange.current)
            onChangeRef.current(editor!.getValue());
        });
        const inline = inlineCompletionRef.current;
        if (inline && !disposed) {
          try {
            const { registerCompletion } = await import("monacopilot");
            if (disposed) return;
            const registration = registerCompletion(
              monaco,
              editor as unknown as MonacoEditorNamespace.IStandaloneCodeEditor,
              {
                language,
                filename: inline.filename,
                technologies: ["react"],
                maxContextLines: 60,
                // Inline completions are best-effort: never surface errors
                // from the network or an unconfigured workspace.
                onError: () => {},
                requestHandler: ({ body }) => {
                  const fetchInline =
                    inlineCompletionRef.current?.fetchCompletion;
                  if (!fetchInline)
                    return Promise.resolve({ completion: null });
                  const pending = fetchInline(
                    body.completionMetadata.textBeforeCursor.slice(-8000),
                    body.completionMetadata.textAfterCursor.slice(0, 8000),
                  ).then(
                    (completion) => ({ completion: completion ?? null }),
                    () => ({ completion: null as string | null }),
                  );
                  const timedOut = new Promise<{ completion: null }>(
                    (resolve) =>
                      window.setTimeout(
                        () => resolve({ completion: null }),
                        15000,
                      ),
                  );
                  return Promise.race([pending, timedOut]);
                },
              },
            );
            stopInlineCompletion = () => registration.deregister();
          } catch {
            // The editor stays fully usable without inline completions.
          }
        }
        if (!disposed) setStatus("ready");
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });

    return () => {
      disposed = true;
      stopThemeObservation?.();
      stopInlineCompletion?.();
      editor?.dispose();
      model?.dispose();
      declarations?.dispose();
      editorRef.current = null;
      setStatus("loading");
    };
  }, [ariaLabel, language, contextDeclarations]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;
    programmaticChange.current = true;
    try {
      editor.setValue(value);
    } finally {
      programmaticChange.current = false;
    }
  }, [value]);

  if (status === "error") {
    return (
      <Textarea
        className="form-html-designer-code form-html-editor-dialog-code"
        rows={Math.max(8, Math.round(height / 20))}
        readOnly={readOnly}
        spellCheck={false}
        aria-label={ariaLabel}
        placeholder={placeholder}
        style={{ fontFamily: "ui-monospace, monospace" }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className="monaco-code-editor" data-status={status}>
      {status === "loading" ? (
        <p className="monaco-code-editor-loading">{t("Cargando editor…")}</p>
      ) : null}
      <div
        ref={containerRef}
        className="monaco-code-editor-surface"
        style={{ height }}
        aria-label={ariaLabel}
      />
    </div>
  );
}
