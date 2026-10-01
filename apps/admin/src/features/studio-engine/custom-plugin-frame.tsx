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
import { pluginApiFetch } from "./api";
import { getStudioRuntime } from "./runtime";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";

type PluginFrameRequest = {
  ns: "savia-plugin";
  type: "request" | "ready" | "error";
  id: string;
  path: string;
  method?: string;
  body?: unknown;
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
  title,
  src,
  screen,
  panelBinding,
  heightClassName = screen
    ? "h-[calc(100dvh-7rem)] min-h-[32rem]"
    : "h-[480px]",
}: {
  pluginId: string;
  title: string;
  src?: string;
  screen?: { object: string; view: string };
  heightClassName?: string;
  panelBinding?: {
    context: PluginPanelContext;
    onEvent: (message: Record<string, unknown>, frame: Window) => void;
    onFrame: (frame: Window | null, session: string) => void;
    onFailure: () => void;
    onRetry: (retry: () => void) => void;
  };
}) {
  const t = useMessages(automationMessages);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const uiSession = useRef("");
  const panelBindingRef = useRef(panelBinding);
  panelBindingRef.current = panelBinding;
  const controller = useRef(createPluginPanelController());
  const [panel, setPanel] = useState<ActivePluginPanel | null>(null);
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
    controller.current.dispose();
    retryAction.current = null;
    setPanel(null);
    setConfirming(false);
    child.current = null;
  }
  function requestClose(discard = false) {
    const active = controller.current.current;
    if (!active || active.state.busy) return;
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
  const shellUrl = `${screenUrl}${screenUrl.includes("?") ? "&" : "?"}theme=${initialTheme}${panelBinding ? "&panel=1" : ""}`;
  const frameKey = `${shellUrl}#${attempt}:${sessionRevision}`;
  const settingsPath = `/extensions/${encodeURIComponent(pluginId)}/settings`;

  useEffect(() => {
    const invalidatePrefetch = (restartForNewIdentity: boolean) => {
      sessionGeneration.current += 1;
      prefetchedSettings.current = null;
      if (restartForNewIdentity) setSessionRevision(sessionGeneration.current);
    };
    const onSessionCleared = () => {
      invalidatePrefetch(false);
      controller.current.dispose();
      retryAction.current = null;
      child.current = null;
      setConfirming(false);
      setPanel(null);
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
    const onIdentityChanged = () => invalidatePrefetch(true);
    window.addEventListener("savia:session-cleared", onSessionCleared);
    window.addEventListener("savia:identity-changed", onIdentityChanged);
    return () => {
      window.removeEventListener("savia:session-cleared", onSessionCleared);
      window.removeEventListener("savia:identity-changed", onIdentityChanged);
    };
  }, []);

  // Screen plugins may read their standard settings endpoint during startup.
  // Start that authenticated tenant request alongside the shell/entry fetch;
  // widgets do not need package settings and therefore skip this prefetch.
  useEffect(() => {
    if (!screen) {
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
      if (event.source !== frameRef.current?.contentWindow) return;
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
              panel: binding?.context ?? null,
            },
            "*",
          );
          return;
        }
        if (!uiSession.current || ui.session !== uiSession.current) return;
        if (binding) {
          if (ui.panelId === binding.context.panelId)
            binding.onEvent(ui, frame);
          return;
        }
        if (ui.type === "open" && typeof ui.id === "string") {
          const active = screen
            ? controller.current.open(ui.id, ui.request)
            : null;
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
          pluginApiFetch<unknown>(
            "/api" + message.path,
            message.body === undefined
              ? { method }
              : { method, body: JSON.stringify(message.body) },
          ));
        // A previous frame must never deliver a pending response to its replacement.
        if (source !== frameRef.current?.contentWindow) return;
        if (requestGeneration !== sessionGeneration.current) {
          frameRef.current?.contentWindow?.postMessage(
            {
              ns: "savia-plugin",
              type: "response",
              id: message.id,
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
            ok: true,
            data,
          },
          "*",
        );
      } catch (error) {
        if (source !== frameRef.current?.contentWindow) return;
        frameRef.current?.contentWindow?.postMessage(
          {
            ns: "savia-plugin",
            type: "response",
            id: message.id,
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
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [frameKey]);

  return (
    <>
      <div
        className={`relative w-full overflow-hidden rounded-md border bg-background ${heightClassName}`}
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
          <div
            role="status"
            className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground"
          >
            {t("Cargando plugins…")}
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
          className={`h-full w-full border-0 ${loadedUrl === frameKey ? "" : "invisible"}`}
        />
      </div>
      {panel && !panelBinding && (
        <PluginHostPanel
          title={panel.request.title}
          busy={panel.state.busy}
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
            title={panel.request.title}
            src={src}
            screen={screen}
            heightClassName="h-full border-0 rounded-none"
            panelBinding={{
              context: { panelId: panel.id, request: panel.request },
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
                if (!active || active.state.busy) return;
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
                  finishPanel({ status: "saved" });
              },
            }}
          />
        </PluginHostPanel>
      )}
    </>
  );
}
