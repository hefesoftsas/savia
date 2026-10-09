import { PwaSplash } from "@/pwa/pwa-splash";
import type {
  PluginPanelContext,
  PluginPanelResult,
} from "@savia/studio-shared/plugin-panels";
import {
  createPluginPanelController,
  type ActivePluginPanel,
} from "./plugin-panel-controller";
import { PluginHostPanel } from "./plugin-host-panel";
import { useEffect, useMemo, useRef, useState } from "react";
import { pluginRecordFetch } from "./plugin-record-transport";
import { pluginApiFetch } from "./api";
import { getStudioRuntime } from "./runtime";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";

type PluginFrameRequest = {
  ns: "savia-plugin";
  type: "request" | "ready" | "error" | "prepared" | "resize";
  id: string;
  path: string;
  method?: string;
  body?: unknown;
  height?: number;
  panelId?: string;
  consistency?: string;
};

type PrefetchedSettings = {
  frameKey: string;
  sessionGeneration: number;
  promise: Promise<unknown>;
};

const THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--border",
  "--input",
  "--muted",
  "--muted-foreground",
  "--primary",
  "--primary-foreground",
  "--accent",
  "--destructive",
  "--ring",
] as const;

function isAllowed(path: string): boolean {
  let decoded = path;
  try {
    for (let i = 0; i < 4; i++) decoded = decodeURIComponent(decoded);
  } catch {
    return false;
  }
  return (
    decoded.startsWith("/") &&
    !decoded.startsWith("//") &&
    !decoded.includes("..") &&
    !decoded.includes("\\") &&
    !/[\r\n]/.test(decoded)
  );
}

/**
 * Ejecuta un plugin del store dentro de un iframe aislado
 * (`sandbox="allow-scripts"`, origen opaco). El plugin nunca toca la
 * red ni el almacenamiento: cada llamada `savia.*` llega por
 * `postMessage` y el host la reenvía a la API ya autorizada.
 */
export function CustomPluginFrame({
  pluginId,
  installationVersion,
  title,
  src,
  screen,
  panelBinding,
  heightClassName,
}: {
  pluginId: string;
  installationVersion?: string;
  title: string;
  src?: string;
  screen?: { object: string; view: string };
  heightClassName?: string;
  panelBinding?: {
    context: PluginPanelContext | null;
    reusable?: boolean;
    onEvent: (message: Record<string, unknown>, frame: Window) => void;
    onFrame: (frame: Window | null, session: string) => void;
    onFailure: () => void;
    onRetry: (retry: () => void) => void;
  };
}) {
  const t = useMessages(automationMessages);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const uiSession = useRef("");
  const revoked = useRef(false);
  const panelBindingRef = useRef(panelBinding);
  panelBindingRef.current = panelBinding;
  const controller = useRef(createPluginPanelController());
  const [panel, setPanel] = useState<ActivePluginPanel | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [accessEnded, setAccessEnded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const retryAction = useRef<(() => void) | null>(null);
  const child = useRef<{ frame: Window; session: string } | null>(null);
  function finishPanel(result: PluginPanelResult) {
    const active = controller.current.current;
    if (!active) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        ns: "savia-plugin-ui",
        version: 1,
        type: "result",
        session: uiSession.current,
        id: active.requestId,
        result,
      },
      "*",
    );
    if (prepared)
      child.current?.frame.postMessage(
        {
          ns: "savia-plugin-ui",
          version: 1,
          type: "deactivate",
          session: child.current.session,
          panelId: active.id,
        },
        "*",
      );
    controller.current.dispose();
    retryAction.current = null;
    setPanel(null);
    setConfirming(false);
    if (!prepared) child.current = null;
  }
  function requestClose(discard = false) {
    const active = controller.current.current;
    if (!active || (active.phase === "active" && active.state.busy)) return;
    if (active.state.dirty && !discard) {
      setConfirming(true);
      return;
    }
    if (retryAction.current) {
      const retry = retryAction.current;
      retryAction.current = null;
      setConfirming(false);
      retry();
      return;
    }
    finishPanel({ status: "cancelled" });
  }
  function focusEditor(backwards = false) {
    child.current?.frame.postMessage(
      {
        ns: "savia-plugin-ui",
        version: 1,
        type: "focus-editor",
        session: child.current.session,
        backwards,
      },
      "*",
    );
  }

  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [readyFrame, setReadyFrame] = useState<string | null>(null);
  const [failedFrame, setFailedFrame] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [contentSize, setContentSize] = useState<{
    frameKey: string;
    height: number;
  } | null>(null);
  const fitContent =
    Boolean(screen) && !panelBinding && heightClassName === undefined;
  const frameHeightClass = heightClassName ?? (screen ? "" : "h-[480px]");
  const sessionGeneration = useRef(0);
  const prefetchedSettings = useRef<PrefetchedSettings | null>(null);
  const shellPath =
    src ??
    `${getStudioRuntime().apiBasePath ?? ""}/api/plugin-store/${encodeURIComponent(pluginId)}/shell`;
  const screenUrl = screen
    ? `${shellPath}${shellPath.includes("?") ? "&" : "?"}screen=${encodeURIComponent(screen.object)}&view=${encodeURIComponent(screen.view)}`
    : shellPath;
  const initialTheme = useMemo(
    () =>
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    [screenUrl],
  );
  const shellUrl = `${screenUrl}${screenUrl.includes("?") ? "&" : "?"}theme=${initialTheme}${panelBinding ? `&panel=1${panelBinding.reusable ? "&standby=1" : ""}` : ""}`;
  const frameKey = `${shellUrl}#${attempt}:${sessionRevision}:${installationVersion ?? ""}`;
  const settingsPath = `/extensions/${encodeURIComponent(pluginId)}/settings`;

  useEffect(() => {
    const invalidatePrefetch = (restartForNewIdentity: boolean) => {
      sessionGeneration.current += 1;
      prefetchedSettings.current = null;
      if (restartForNewIdentity) setSessionRevision(sessionGeneration.current);
    };
    const onSessionCleared = () => {
      revoked.current = true;
      setAccessEnded(true);
      invalidatePrefetch(false);
      controller.current.dispose();
      retryAction.current = null;
      child.current = null;
      setConfirming(false);
      setPanel(null);
      setPrepared(false);
      frameRef.current?.contentWindow?.postMessage(
        {
          ns: "savia-plugin-ui",
          version: 1,
          type: "dispose",
          session: uiSession.current,
        },
        "*",
      );
      uiSession.current = "";
    };
    const onPrincipalChanged = () => {
      revoked.current = false;
      setAccessEnded(false);
      invalidatePrefetch(true);
    };
    window.addEventListener("savia:session-cleared", onSessionCleared);
    window.addEventListener("savia:principal-changed", onPrincipalChanged);
    return () => {
      window.removeEventListener("savia:session-cleared", onSessionCleared);
      window.removeEventListener("savia:principal-changed", onPrincipalChanged);
    };
  }, []);

  // Screen plugins may read their standard settings endpoint during startup.
  // Start that authenticated tenant request alongside the shell/entry fetch;
  // widgets do not need package settings and therefore skip this prefetch.
  useEffect(() => {
    if (!screen || panelBinding?.reusable) {
      prefetchedSettings.current = null;
      return;
    }
    const request: PrefetchedSettings = {
      frameKey,
      sessionGeneration: sessionGeneration.current,
      promise: pluginApiFetch<unknown>(`/api${settingsPath}`, {
        method: "GET",
      }),
    };
    prefetchedSettings.current = request;
    // The frame may not call settings.get, but a prefetch failure must not be
    // reported as an unhandled rejection. The original promise stays awaitable.
    void request.promise.catch(() => undefined);
    return () => {
      if (prefetchedSettings.current === request)
        prefetchedSettings.current = null;
    };
  }, [frameKey, screen?.object, screen?.view, sessionRevision, settingsPath]);

  useEffect(() => {
    if (readyFrame === frameKey) return;
    const timeout = window.setTimeout(() => setFailedFrame(frameKey), 30_000);
    return () => window.clearTimeout(timeout);
  }, [frameKey, readyFrame]);

  useEffect(() => {
    if (failedFrame === frameKey) panelBindingRef.current?.onFailure();
  }, [failedFrame, frameKey]);

  useEffect(() => {
    let handshakeNonce = "";
    function sendTheme() {
      const host = getComputedStyle(document.documentElement);
      frameRef.current?.contentWindow?.postMessage(
        {
          ns: "savia-plugin",
          type: "theme",
          vars: Object.fromEntries(
            THEME_VARIABLES.map((name) => [
              name,
              host.getPropertyValue(name).trim(),
            ]),
          ),
          dark: document.documentElement.classList.contains("dark"),
        },
        "*",
      );
    }
    async function onMessage(event: MessageEvent) {
      if (revoked.current || event.source !== frameRef.current?.contentWindow)
        return;
      const ui = event.data;
      if (ui?.ns === "savia-plugin-ui" && ui.version === 1) {
        const frame = frameRef.current!.contentWindow!;
        const binding = panelBindingRef.current;
        if (
          ui.type === "hello" &&
          typeof ui.nonce === "string" &&
          ui.nonce.length <= 128
        ) {
          if (handshakeNonce && handshakeNonce !== ui.nonce) return;
          if (!handshakeNonce) uiSession.current = crypto.randomUUID();
          handshakeNonce = ui.nonce;
          binding?.onFrame(frame, uiSession.current);
          frame.postMessage(
            {
              ns: "savia-plugin-ui",
              version: 1,
              type: "init",
              nonce: ui.nonce,
              session: uiSession.current,
              panel: binding?.reusable ? null : (binding?.context ?? null),
            },
            "*",
          );
          if (binding?.reusable && binding.context)
            frame.postMessage(
              {
                ns: "savia-plugin-ui",
                version: 1,
                type: "activate",
                session: uiSession.current,
                panel: binding.context,
              },
              "*",
            );
          return;
        }
        if (!uiSession.current || ui.session !== uiSession.current) return;
        if (binding) {
          if (binding.context && ui.panelId === binding.context.panelId)
            binding.onEvent(ui, frame);
          return;
        }
        if (ui.type === "prepare") {
          setPrepared(true);
          return;
        }
        if (ui.type === "open" && typeof ui.id === "string") {
          const active = controller.current.open(ui.id, ui.request);
          if (active) setPanel({ ...active });
          else
            frame.postMessage(
              {
                ns: "savia-plugin-ui",
                version: 1,
                type: "result",
                session: uiSession.current,
                id: ui.id,
                error: "Panel unavailable.",
              },
              "*",
            );
        }
        return;
      }
      const message = event.data as Partial<PluginFrameRequest>;
      if (!message || message.ns !== "savia-plugin") return;
      if (message.type === "resize") {
        if (
          fitContent &&
          typeof message.height === "number" &&
          Number.isFinite(message.height) &&
          message.height > 0
        ) {
          setContentSize({
            frameKey,
            height: Math.min(100_000, Math.ceil(message.height)),
          });
        }
        return;
      }
      if (
        panelBindingRef.current?.reusable &&
        message.type !== "prepared" &&
        !(message.type === "error" && message.panelId === undefined) &&
        (!panelBindingRef.current.context ||
          message.panelId !== panelBindingRef.current.context.panelId)
      )
        return;
      if (message.type === "prepared") {
        if (panelBindingRef.current?.reusable) {
          setReadyFrame(frameKey);
          setLoadedUrl(frameKey);
          setFailedFrame(null);
          sendTheme();
        }
        return;
      }
      if (message.type === "ready") {
        setLoadedUrl(frameKey);
        setReadyFrame(frameKey);
        setFailedFrame(null);
        sendTheme();
        return;
      }
      if (message.type === "error") {
        setFailedFrame(frameKey);
        return;
      }
      if (message.type !== "request" || typeof message.id !== "string") return;
      if (typeof message.path !== "string" || !isAllowed(message.path)) {
        frameRef.current?.contentWindow?.postMessage(
          {
            ns: "savia-plugin",
            type: "response",
            id: message.id,
            panelId: message.panelId,
            ok: false,
            error: "Ruta no permitida para este plugin.",
          },
          "*",
        );
        return;
      }
      const source = frameRef.current?.contentWindow;
      const method = message.method ?? "GET";
      const requestGeneration = sessionGeneration.current;
      const isSettingsRead =
        message.path === settingsPath && method.toUpperCase() === "GET";
      if (message.path === settingsPath && method.toUpperCase() !== "GET")
        prefetchedSettings.current = null;
      const prefetched = prefetchedSettings.current;
      const reusableSettings =
        isSettingsRead &&
        prefetched?.frameKey === frameKey &&
        prefetched.sessionGeneration === requestGeneration
          ? prefetched.promise
          : null;
      if (reusableSettings) prefetchedSettings.current = null;
      try {
        const data = await (reusableSettings ??
          pluginRecordFetch<unknown>(
            "/api" + message.path,
            message.body === undefined
              ? { method }
              : { method, body: JSON.stringify(message.body) },
            message.consistency,
          ));
        // A previous frame must never deliver a pending response to its replacement.
        if (source !== frameRef.current?.contentWindow) return;
        if (
          panelBindingRef.current?.reusable &&
          message.panelId !== panelBindingRef.current.context?.panelId
        )
          return;
        if (requestGeneration !== sessionGeneration.current) {
          frameRef.current?.contentWindow?.postMessage(
            {
              ns: "savia-plugin",
              type: "response",
              id: message.id,
              panelId: message.panelId,
              ok: false,
              error: "La sesión cambió durante la solicitud.",
            },
            "*",
          );
          return;
        }
        frameRef.current?.contentWindow?.postMessage(
          {
            ns: "savia-plugin",
            type: "response",
            id: message.id,
            panelId: message.panelId,
            ok: true,
            data,
          },
          "*",
        );
      } catch (error) {
        if (source !== frameRef.current?.contentWindow) return;
        if (
          panelBindingRef.current?.reusable &&
          message.panelId !== panelBindingRef.current.context?.panelId
        )
          return;
        frameRef.current?.contentWindow?.postMessage(
          {
            ns: "savia-plugin",
            type: "response",
            id: message.id,
            panelId: message.panelId,
            ok: false,
            error: error instanceof Error ? error.message : "Error del host.",
          },
          "*",
        );
      }
    }
    window.addEventListener("message", onMessage);
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-color-theme"],
    });
    return () => {
      frameRef.current?.contentWindow?.postMessage(
        {
          ns: "savia-plugin-ui",
          version: 1,
          type: "dispose",
          session: uiSession.current,
        },
        "*",
      );
      uiSession.current = "";
      controller.current.dispose();
      retryAction.current = null;
      child.current = null;
      setConfirming(false);
      setPanel(null);
      setPrepared(false);
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [frameKey, fitContent]);

  useEffect(() => {
    if (!panelBinding?.reusable || !uiSession.current) return;
    const context = panelBinding.context;
    if (context)
      frameRef.current?.contentWindow?.postMessage(
        {
          ns: "savia-plugin-ui",
          version: 1,
          type: "activate",
          session: uiSession.current,
          panel: context,
        },
        "*",
      );
  }, [panelBinding?.context?.panelId, frameKey]);

  useEffect(() => {
    if (panelBinding) return;
    const workspace = getStudioRuntime().localWorkspace;
    if (!workspace) return;
    let subscribed = true;
    let revision = 0;
    let recordsChanged = false;
    let lastStatus = "";
    const publish = (changed: boolean) => {
      recordsChanged ||= changed;
      const expected = ++revision;
      void workspace.store
        .status()
        .then((status) => {
          if (!subscribed || expected !== revision || revoked.current) return;
          const summary = {
            pending: status.pending,
            conflicts: status.conflicts,
            errors: status.errors,
          };
          const signature = JSON.stringify(summary);
          if (recordsChanged || signature !== lastStatus) {
            lastStatus = signature;
            recordsChanged = false;
            frameRef.current?.contentWindow?.postMessage(
              { ns: "savia-plugin", type: "records-changed", status: summary },
              "*",
            );
          }
        })
        .catch(() => undefined);
    };
    const unsubscribe = workspace.store.subscribeQueryChanges((change) => {
      if (change.authorizationError) {
        revoked.current = true;
        setAccessEnded(true);
        controller.current.dispose();
        setPanel(null);
        setPrepared(false);
        frameRef.current?.contentWindow?.postMessage(
          {
            ns: "savia-plugin-ui",
            version: 1,
            session: uiSession.current,
            type: "dispose",
          },
          "*",
        );
        return;
      }
      if (change.changed.size || change.metadataChanged) publish(true);
    });
    const unsubscribeStatus = workspace.store.subscribe(() => publish(false));
    return () => {
      subscribed = false;
      unsubscribe();
      unsubscribeStatus();
    };
  }, [frameKey, readyFrame]);

  return accessEnded ? (
    <div role="alert" className="rounded-md border p-6 text-sm">
      {t("Plugin session ended. Reload to reconnect.")}
    </div>
  ) : (
    <>
      <div
        className={`relative w-full overflow-hidden rounded-md border bg-background ${frameHeightClass}`}
      >
        {failedFrame === frameKey ? (
          <div
            role="alert"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center"
          >
            <p>{t("Plugin could not be loaded.")}</p>
            <Button
              variant="outline"
              onClick={() => {
                const retry = () => setAttempt((value) => value + 1);
                if (panelBinding) panelBinding.onRetry(retry);
                else retry();
              }}
            >
              {t("Reintentar")}
            </Button>
          </div>
        ) : readyFrame !== frameKey ? (
          <div className="absolute inset-0 z-10 bg-background">
            <PwaSplash contained message={t("Cargando…")} />
          </div>
        ) : null}
        <iframe
          key={frameKey}
          ref={frameRef}
          src={shellUrl}
          sandbox="allow-scripts allow-downloads"
          title={title}
          onLoad={() => setLoadedUrl(frameKey)}
          onError={() => setFailedFrame(frameKey)}
          style={
            fitContent
              ? {
                  height:
                    contentSize?.frameKey === frameKey
                      ? contentSize.height
                      : 512,
                }
              : undefined
          }
          className={`block h-full w-full border-0 ${loadedUrl === frameKey ? "" : "invisible"}`}
        />
      </div>
      {(panel || prepared) && !panelBinding && (
        <PluginHostPanel
          open={!!panel}
          retained={prepared}
          title={panel?.request.title ?? title}
          busy={panel?.phase === "active" && panel.state.busy}
          confirming={confirming}
          closeRef={closeRef}
          onClose={() => requestClose()}
          onDiscard={() => requestClose(true)}
          onKeep={() => {
            retryAction.current = null;
            setConfirming(false);
          }}
          onFocusEditor={focusEditor}
        >
          <CustomPluginFrame
            pluginId={pluginId}
            installationVersion={installationVersion}
            title={
              panel?.request.title ?? t("Editor de %{value}", { value: title })
            }
            src={src}
            screen={screen}
            heightClassName="h-full border-0 rounded-none"
            panelBinding={{
              context: panel
                ? { panelId: panel.id, request: panel.request }
                : null,
              reusable: prepared,
              onFrame: (frame, session) => {
                child.current = frame ? { frame, session } : null;
              },
              onFailure: () => {
                const active = controller.current.current;
                if (active) {
                  controller.current.update({ ...active.state, busy: false });
                  setPanel({ ...active });
                }
              },
              onRetry: (retry) => {
                const active = controller.current.current;
                if (!active || (active.phase === "active" && active.state.busy))
                  return;
                if (active.state.dirty) {
                  retryAction.current = retry;
                  setConfirming(true);
                } else retry();
              },
              onEvent: (message) => {
                const active = controller.current.current;
                if (!active || message.panelId !== active.id) return;
                if (message.type === "state") {
                  controller.current.update(message.state);
                  setPanel({ ...active });
                }
                if (message.type === "close") requestClose();
                if (message.type === "focus-host") closeRef.current?.focus();
                if (
                  message.type === "complete" &&
                  (message.result as PluginPanelResult)?.status === "saved"
                )
                  finishPanel({
                    status: "saved",
                    ...((message.result as PluginPanelResult).persistence ===
                    "local"
                      ? {
                          persistence: "local",
                          mutationId: (message.result as PluginPanelResult)
                            .mutationId,
                        }
                      : {}),
                  });
              },
            }}
          />
        </PluginHostPanel>
      )}
    </>
  );
}
