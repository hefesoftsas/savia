import { useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/i18n/core";
import { pluginEditorExtensionsMessages } from "./plugin-editor-extensions-messages";
import { editorEventSchema, type EditorState } from "./plugin-vscode-protocol";
import { observePluginIdeTheme, readPluginIdeTheme } from "./plugin-ide-theme";

type CompletionRequest = {
  type: "savia-editor-completion";
  requestId: string;
  prefix: string;
  suffix: string;
};

function isCompletionRequest(value: unknown): value is CompletionRequest {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<CompletionRequest>;
  return (
    message.type === "savia-editor-completion" &&
    typeof message.requestId === "string" &&
    typeof message.prefix === "string" &&
    typeof message.suffix === "string"
  );
}

export function PluginVscodeEditor({
  files,
  activeFile,
  extensions,
  readOnly,
  selection,
  formatRequest = 0,
  hidden = false,
  onChange,
  onSearch,
  onError,
  fetchCompletion,
}: {
  files: Record<string, string>;
  activeFile: string;
  extensions: string[];
  readOnly: boolean;
  selection?: { lineNumber: number; column: number; endColumn: number };
  formatRequest?: number;
  hidden?: boolean;
  onChange(path: string, value: string): void;
  onSearch(): void;
  onError(message: string): void;
  fetchCompletion?: (prefix: string, suffix: string) => Promise<string | null>;
}) {
  const t = useMessages(pluginEditorExtensionsMessages);
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() =>
    readPluginIdeTheme(document.documentElement),
  );
  const selectionId = useMemo(() => crypto.randomUUID(), [selection]);
  const pendingEdits = useRef(
    new Map<string, { sequence: number; value: string }>(),
  );
  const latest = useRef({
    files,
    activeFile,
    extensions,
    readOnly,
    selection,
    onChange,
    onSearch,
    onError,
    fetchCompletion,
  });
  latest.current = {
    files,
    activeFile,
    extensions,
    readOnly,
    selection,
    onChange,
    onSearch,
    onError,
    fetchCompletion,
  };

  useEffect(
    () => observePluginIdeTheme(document.documentElement, setTheme),
    [],
  );

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== location.origin
      )
        return;

      if (isCompletionRequest(event.data)) {
        const current = latest.current;
        const canComplete =
          !current.readOnly &&
          current.activeFile === "entry.tsx" &&
          current.fetchCompletion !== undefined;
        void (async () => {
          let value: string | null = null;
          if (canComplete) {
            try {
              value = await current.fetchCompletion!(
                event.data.prefix,
                event.data.suffix,
              );
            } catch {
              value = null;
            }
          }
          const latestState = latest.current;
          if (latestState.readOnly || latestState.activeFile !== "entry.tsx")
            value = null;
          frame.current?.contentWindow?.postMessage(
            {
              type: "savia-editor-completion-result",
              requestId: event.data.requestId,
              value,
            },
            location.origin,
          );
        })();
        return;
      }

      const parsed = editorEventSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === "savia-editor-ready") {
        setReady(true);
      } else if (message.type === "savia-editor-search") {
        latest.current.onSearch();
      } else if (message.type === "savia-editor-error") {
        setError(message.message);
        latest.current.onError(message.message);
      } else if (
        !latest.current.readOnly &&
        Object.hasOwn(latest.current.files, message.path)
      ) {
        const previous = pendingEdits.current.get(message.path);
        if (!previous || message.sequence > previous.sequence) {
          pendingEdits.current.set(message.path, {
            sequence: message.sequence,
            value: message.value,
          });
          latest.current.onChange(message.path, message.value);
        }
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const acknowledgements: Record<string, number> = {};
  for (const [path, pending] of pendingEdits.current) {
    if (!Object.hasOwn(files, path)) {
      pendingEdits.current.delete(path);
      continue;
    }
    if (files[path] === pending.value)
      acknowledgements[path] = pending.sequence;
  }

  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage(
      {
        type: "savia-editor-state",
        files,
        activeFile,
        acknowledgements,
        extensions,
        readOnly,
        selection: selection ?? null,
        selectionId,
        theme,
      } satisfies Omit<EditorState, "extensions"> & { extensions: string[] },
      location.origin,
    );
  }, [
    ready,
    files,
    activeFile,
    acknowledgements,
    extensions,
    readOnly,
    selection,
    selectionId,
    theme,
  ]);

  const observedFormatRequest = useRef(formatRequest);
  const pendingFormatRequests = useRef(0);
  useEffect(() => {
    if (formatRequest < observedFormatRequest.current) {
      observedFormatRequest.current = formatRequest;
      pendingFormatRequests.current = 0;
    } else {
      pendingFormatRequests.current +=
        formatRequest - observedFormatRequest.current;
      observedFormatRequest.current = formatRequest;
    }
    if (!ready || readOnly) return;
    while (pendingFormatRequests.current > 0) {
      frame.current?.contentWindow?.postMessage(
        { type: "savia-editor-format" },
        location.origin,
      );
      pendingFormatRequests.current -= 1;
    }
  }, [formatRequest, ready, readOnly]);

  return (
    <>
      {!hidden && (!ready || error) && (
        <p role={error ? "alert" : "status"}>{error || t("loading")}</p>
      )}
      <iframe
        ref={frame}
        className="plugin-vscode-editor"
        src="/plugin-editor.html"
        title={activeFile}
        hidden={hidden}
        sandbox="allow-scripts allow-same-origin"
      />
    </>
  );
}
