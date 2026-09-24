import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  loadMonacoFromCdn,
  resolveMonacoTheme,
  type MonacoEditorInstance,
} from "./monaco-cdn";

export function MonacoCodeEditor({
  value,
  onChange,
  language,
  height = 280,
  placeholder,
  ariaLabel,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  language: "html" | "javascript" | "typescript" | "json";
  readOnly?: boolean;
  height?: number;
  placeholder?: string;
  ariaLabel: string;
}) {
  const t = useMessages(recordsMessages);

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let disposed = false;
    let editor: MonacoEditorInstance | null = null;
    let model: { dispose: () => void } | undefined;
    let declarations: { dispose: () => void } | undefined;

    loadMonacoFromCdn()
      .then((monaco) => {
        if (disposed || !containerRef.current) return;
        if (language === "typescript") {
          monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            jsx: 2,
            target: 7,
            allowNonTsExtensions: true,
          });
          declarations =
            monaco.languages.typescript.typescriptDefaults.addExtraLib(
              `
            interface ResultsProps {
              rows: { id: string; title: string; status: string; date: string; simulation: boolean; values: string[]; errors: string[]; response: unknown }[];
              columns: { label: string; pointer: string; format: "text" | "money" }[];
              disabled: boolean;
              load(id: string): void;
            }
            declare const React: { useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void]; Fragment: any; createElement: any };
          `,
              "file:///savia-results-context.d.ts",
            );
          model = monaco.editor.createModel(
            value,
            language,
            monaco.Uri.parse(
              `inmemory://savia/results-${crypto.randomUUID()}.tsx`,
            ),
          );
        }
        editor = monaco.editor.create(containerRef.current, {
          ...(model ? { model } : { value, language }),
          theme: resolveMonacoTheme(),
          readOnly,
          folding: true,
          bracketPairColorization: { enabled: true },
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 8, bottom: 8 },
          ariaLabel,
        });
        editorRef.current = editor;
        editor.onDidChangeModelContent(() => {
          onChangeRef.current(editor!.getValue());
        });
        setStatus("ready");
      })
      .catch(() => setStatus("error"));

    return () => {
      disposed = true;
      editor?.dispose();
      model?.dispose();
      declarations?.dispose();
      editorRef.current = null;
      setStatus("loading");
    };
  }, [ariaLabel, language, readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;
    editor.setValue(value);
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
