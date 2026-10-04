import { useEffect, useRef, useState } from "react";
import { applyMonacoTheme, loadMonacoFromCdn } from "./monaco-cdn";
import { observePluginIdeTheme } from "./plugin-ide-theme";

export function PluginDiffEditor({
  original,
  modified,
  filename,
  originalLabel,
  modifiedLabel,
}: {
  original: string;
  modified: string;
  filename: string;
  originalLabel: string;
  modifiedLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void loadMonacoFromCdn()
      .then((monaco) => {
        if (disposed || !container.current) return;
        const language = filename.endsWith("tsx") ? "typescript" : "json";
        const before = monaco.editor.createModel(
          original,
          language,
          monaco.Uri.parse(
            `inmemory://savia/diff-${crypto.randomUUID()}/${filename}`,
          ),
        );
        const after = monaco.editor.createModel(
          modified,
          language,
          monaco.Uri.parse(
            `inmemory://savia/diff-${crypto.randomUUID()}/${filename}`,
          ),
        );
        const editor = monaco.editor.createDiffEditor(container.current, {
          readOnly: true,
          originalEditable: false,
          automaticLayout: true,
          renderSideBySide: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        });
        editor.setModel({ original: before, modified: after });
        const stop = observePluginIdeTheme(document.documentElement, (theme) =>
          applyMonacoTheme(monaco, theme),
        );
        cleanup = () => {
          stop();
          editor.dispose();
          before.dispose();
          after.dispose();
        };
      })
      .catch(() => {
        if (!disposed) setFallback(true);
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [original, modified, filename]);
  if (fallback)
    return (
      <div className="plugin-ide-diff-fallback">
        <h4>{originalLabel}</h4>
        <pre>{original}</pre>
        <h4>{modifiedLabel}</h4>
        <pre>{modified}</pre>
      </div>
    );
  return (
    <div
      ref={container}
      className="plugin-ide-diff-editor"
      aria-label={`${originalLabel} / ${modifiedLabel}: ${filename}`}
    />
  );
}
