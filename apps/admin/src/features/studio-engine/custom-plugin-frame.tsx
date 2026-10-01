import { useEffect, useMemo, useRef, useState } from "react";
import { pluginApiFetch } from "./api";
import { getStudioRuntime } from "./runtime";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";

type PluginFrameRequest = {
  ns: "savia-plugin";
  type: "request" | "ready" | "error" | "resize";
  id: string;
  path: string;
  method?: string;
  body?: unknown;
  height?: number;
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
  heightClassName,
}: {
  pluginId: string;
  title: string;
  src?: string;
  screen?: { object: string; view: string };
  heightClassName?: string;
}) {
  const t = useMessages(automationMessages);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [readyFrame, setReadyFrame] = useState<string | null>(null);
  const [failedFrame, setFailedFrame] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [contentSize, setContentSize] = useState<{
    frameKey: string;
    height: number;
  } | null>(null);
  const fitContent = Boolean(screen) && heightClassName === undefined;
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
  const shellUrl = `${screenUrl}${screenUrl.includes("?") ? "&" : "?"}theme=${initialTheme}`;
  const frameKey = `${shellUrl}#${attempt}`;
  const settingsPath = `/extensions/${encodeURIComponent(pluginId)}/settings`;

  useEffect(() => {
    const invalidatePrefetch = (restartForNewIdentity: boolean) => {
      sessionGeneration.current += 1;
      prefetchedSettings.current = null;
      if (restartForNewIdentity) setSessionRevision(sessionGeneration.current);
    };
    const onSessionCleared = () => invalidatePrefetch(false);
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
      const message = event.data as Partial<PluginFrameRequest>;
      if (!message || message.ns !== "savia-plugin") return;
      if (message.type === "resize") {
        if (
          fitContent &&
          typeof message.height === "number" &&
          Number.isFinite(message.height) &&
          message.height > 0
        ) {
          setContentSize({ frameKey, height: Math.ceil(message.height) });
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
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [frameKey, fitContent]);

  return (
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
            onClick={() => setAttempt((value) => value + 1)}
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
        style={
          fitContent
            ? {
                height:
                  contentSize?.frameKey === frameKey ? contentSize.height : 512,
              }
            : undefined
        }
        className={`block h-full w-full border-0 ${loadedUrl === frameKey ? "" : "invisible"}`}
      />
    </div>
  );
}
