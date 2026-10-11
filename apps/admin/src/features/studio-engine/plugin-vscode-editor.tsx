import { useEffect, useMemo, useRef, useState } from "react";
import type {
  InstalledEditorExtension,
  ProjectEditorExtensionReference,
} from "@savia/studio-shared/plugin-editor-extensions";
import { transferEditorExtension } from "./plugin-editor-extension-transfer";
import { useMessages } from "@/i18n/core";
import { pluginEditorExtensionsMessages } from "./plugin-editor-extensions-messages";
import { editorEventSchema, type EditorState } from "./plugin-vscode-protocol";
import {
  acceptEditorEnvelope,
  resolvePluginEditorRuntimeUrl,
} from "./plugin-editor-session";
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
    message.requestId.length <= 80 &&
    typeof message.prefix === "string" &&
    typeof message.suffix === "string"
  );
}

export function PluginVscodeEditor({
  projectId = "draft",
  runtimeUrl = import.meta.env.VITE_PLUGIN_EDITOR_RUNTIME_URL,
  files,
  activeFile,
  extensions,
  installedExtensions = [],
  loadInstalledExtension,
  onExtensionStatus,
  onExtensionsApplied,
  readOnly,
  selection,
  formatRequest = 0,
  hidden = false,
  onChange,
  onSearch,
  onError,
  fetchCompletion,
}: {
  projectId?: string;
  runtimeUrl?: string;
  files: Record<string, string>;
  activeFile: string;
  extensions: string[];
  installedExtensions?: ProjectEditorExtensionReference[];
  loadInstalledExtension?: (
    reference: ProjectEditorExtensionReference,
  ) => Promise<{ installation: InstalledEditorExtension; bytes: Uint8Array }>;
  onExtensionStatus?: (installationId: string, error: string | null) => void;
  onExtensionsApplied?: (
    references: ProjectEditorExtensionReference[],
    error?: string,
  ) => void;
  readOnly: boolean;
  selection?: { lineNumber: number; column: number; endColumn: number };
  formatRequest?: number;
  hidden?: boolean;
  onChange(path: string, value: string): void;
  onSearch(): void;
  onError(message: string): void;
  fetchCompletion?: (prefix: string, suffix: string) => Promise<string | null>;
}) {
  const session = useMemo(
    () => ({
      nonce: crypto.randomUUID(),
      projectId,
      parentOrigin: location.origin,
    }),
    [projectId],
  );
  const runtime = resolvePluginEditorRuntimeUrl(runtimeUrl, location.origin);
  const frameOrigin = runtime?.origin ?? location.origin;
  const frameUrl = new URL(
    runtime?.href ?? "/plugin-editor.html",
    location.origin,
  );
  frameUrl.hash = new URLSearchParams(session).toString();
  const t = useMessages(pluginEditorExtensionsMessages);
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() =>
    readPluginIdeTheme(document.documentElement),
  );
  const selectionId = useMemo(() => crypto.randomUUID(), [selection]);
  const loadedExtensions = useRef(new Set<string>());
  const packageAcks = useRef(
    new Map<string, { resolve(): void; reject(error: Error): void }>(),
  );
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
    loadInstalledExtension,
    onExtensionStatus,
    onExtensionsApplied,
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
    loadInstalledExtension,
    onExtensionStatus,
    onExtensionsApplied,
  };

  useEffect(
    () => observePluginIdeTheme(document.documentElement, setTheme),
    [],
  );

  useEffect(() => {
    setReady(false);
    pendingEdits.current.clear();
    loadedExtensions.current.clear();
    let completionsInFlight = 0;
    let sessionActive = true;
    const listener = (event: MessageEvent) => {
      const data = acceptEditorEnvelope(
        event,
        frame.current?.contentWindow,
        frameOrigin,
        session,
      );
      if (!data) return;
      const ack = data as { type?: unknown; ackId?: unknown; error?: unknown };
      if (
        ack.type === "savia-editor-package-ack" &&
        typeof ack.ackId === "string" &&
        ack.ackId.length <= 80
      ) {
        const pending = packageAcks.current.get(ack.ackId);
        if (pending) {
          packageAcks.current.delete(ack.ackId);
          if (typeof ack.error === "string")
            pending.reject(new Error(ack.error.slice(0, 2000)));
          else pending.resolve();
        }
        return;
      }

      if (isCompletionRequest(data)) {
        if (
          data.prefix.length > 100 * 1024 ||
          data.suffix.length > 100 * 1024 ||
          completionsInFlight >= 4
        )
          return;
        completionsInFlight += 1;
        const requestFrame = event.source as Window;
        const current = latest.current;
        const canComplete =
          !current.readOnly &&
          current.activeFile === "entry.tsx" &&
          current.fetchCompletion !== undefined;
        void (async () => {
          let value: string | null = null;
          if (canComplete) {
            try {
              value = await current.fetchCompletion!(data.prefix, data.suffix);
            } catch {
              value = null;
            }
          }
          const latestState = latest.current;
          if (latestState.readOnly || latestState.activeFile !== "entry.tsx")
            value = null;
          completionsInFlight -= 1;
          if (!sessionActive || requestFrame !== frame.current?.contentWindow)
            return;
          requestFrame.postMessage(
            {
              session,
              message: {
                type: "savia-editor-completion-result",
                requestId: data.requestId,
                value,
              },
            },
            frameOrigin,
          );
        })();
        return;
      }

      const parsed = editorEventSchema.safeParse(data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === "savia-editor-ready") {
        setReady(true);
      } else if (message.type === "savia-editor-state-applied") {
        latest.current.onExtensionsApplied?.(
          message.installedExtensions,
          message.error,
        );
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
    return () => {
      sessionActive = false;
      window.removeEventListener("message", listener);
      for (const pending of packageAcks.current.values())
        pending.reject(new Error("Editor session ended."));
      packageAcks.current.clear();
    };
  }, [session, frameOrigin]);

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
        session,
        message: {
          type: "savia-editor-state",
          files,
          activeFile,
          acknowledgements,
          extensions,
          installedExtensions,
          readOnly,
          selection: selection ?? null,
          selectionId,
          theme,
        } satisfies Omit<EditorState, "extensions"> & { extensions: string[] },
      },
      frameOrigin,
    );
  }, [
    ready,
    session,
    frameOrigin,
    files,
    activeFile,
    acknowledgements,
    extensions,
    installedExtensions,
    readOnly,
    selection,
    selectionId,
    theme,
  ]);

  const referenceKey = JSON.stringify(installedExtensions);
  useEffect(() => {
    if (!ready || !runtime || !latest.current.loadInstalledExtension) return;
    let cancelled = false;
    const references = JSON.parse(
      referenceKey,
    ) as ProjectEditorExtensionReference[];
    for (const id of loadedExtensions.current)
      if (!references.some((ref) => ref.installationId === id))
        loadedExtensions.current.delete(id);
    void (async () => {
      const packages = new Map<
        string,
        Awaited<ReturnType<NonNullable<typeof loadInstalledExtension>>>
      >();
      for (const reference of references) {
        try {
          const pkg = await latest.current.loadInstalledExtension!(reference);
          if (cancelled) return;
          if (
            pkg.installation.installationId !== reference.installationId ||
            pkg.installation.sha256 !== reference.sha256
          )
            throw new Error("Installed extension identity mismatch.");
          packages.set(reference.installationId, pkg);
        } catch (error) {
          if (!cancelled)
            latest.current.onExtensionStatus?.(
              reference.installationId,
              String(error).slice(0, 2000),
            );
        }
      }
      const pending = references.filter(
        (ref) =>
          !loadedExtensions.current.has(ref.installationId) &&
          packages.has(ref.installationId),
      );
      while (pending.length && !cancelled) {
        const index = pending.findIndex((ref) =>
          packages
            .get(ref.installationId)!
            .installation.dependencies.every((dependency) =>
              [...packages.values()].some(
                (pkg) =>
                  pkg.installation.id === dependency &&
                  loadedExtensions.current.has(pkg.installation.installationId),
              ),
            ),
        );
        if (index < 0) {
          for (const ref of pending)
            latest.current.onExtensionStatus?.(
              ref.installationId,
              "Extension packages have missing or circular dependencies.",
            );
          return;
        }
        const [reference] = pending.splice(index, 1);
        try {
          const { installation, bytes } = packages.get(
            reference.installationId,
          )!;
          await transferEditorExtension(
            session,
            installation,
            bytes,
            async (envelope) => {
              if (cancelled) throw new Error("Editor session changed.");
              const ackId = crypto.randomUUID();
              const payload = envelope as {
                session: unknown;
                message: Record<string, unknown>;
              };
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                  packageAcks.current.delete(ackId);
                  reject(new Error("Extension activation timed out."));
                }, 15000);
                packageAcks.current.set(ackId, {
                  resolve: () => {
                    clearTimeout(timer);
                    resolve();
                  },
                  reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                  },
                });
                frame.current?.contentWindow?.postMessage(
                  { ...payload, message: { ...payload.message, ackId } },
                  frameOrigin,
                );
              });
            },
          );
          if (cancelled) return;
          loadedExtensions.current.add(reference.installationId);
          latest.current.onExtensionStatus?.(reference.installationId, null);
        } catch (error) {
          if (!cancelled)
            latest.current.onExtensionStatus?.(
              reference.installationId,
              String(error).slice(0, 2000),
            );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, referenceKey, session, frameOrigin]);

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
        { session, message: { type: "savia-editor-format" } },
        frameOrigin,
      );
      pendingFormatRequests.current -= 1;
    }
  }, [formatRequest, ready, readOnly, session, frameOrigin]);

  return (
    <>
      {!hidden && (!ready || error) && (
        <p role={error ? "alert" : "status"}>{error || t("loading")}</p>
      )}
      <iframe
        key={session.nonce}
        ref={frame}
        className="plugin-vscode-editor"
        src={frameUrl.href}
        title={activeFile}
        hidden={hidden}
        sandbox="allow-scripts allow-same-origin"
      />
    </>
  );
}
