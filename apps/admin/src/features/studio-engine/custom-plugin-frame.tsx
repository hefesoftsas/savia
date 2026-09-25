import { useEffect, useRef } from "react";
import { apiFetch } from "./api";
import { getStudioRuntime } from "./runtime";

type PluginFrameRequest = {
  ns: "savia-plugin";
  type: "request" | "ready";
  id: string;
  path: string;
  method?: string;
  body?: unknown;
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

/**
 * Rutas que un plugin del store puede pedir al host. Todo lo demás
 * se rechaza: el iframe no tiene red propia y el padre solo reenvía
 * estas rutas con la sesión actual del usuario.
 */
const ALLOWED_PATHS: ReadonlyArray<(path: string) => boolean> = [
  (path) => path === "/objects",
  (path) => path === "/access-context",
  (path) => path.startsWith("/records/"),
  (path) => path.startsWith("/extensions/"),
  (path) => path.startsWith("/lookups/"),
  (path) => path.startsWith("/geocoding/"),
  (path) => path.startsWith("/files/"),
  (path) => path.startsWith("/file/"),
];

function isAllowed(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
    return false;
  return ALLOWED_PATHS.some((rule) => rule(path));
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
  heightClassName = screen
    ? "h-[calc(100dvh-7rem)] min-h-[32rem]"
    : "h-[480px]",
}: {
  pluginId: string;
  title: string;
  src?: string;
  screen?: { object: string; view: string };
  heightClassName?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const shellPath =
    src ??
    `${getStudioRuntime().apiBasePath ?? ""}/api/plugin-store/${encodeURIComponent(pluginId)}/shell`;
  const shellUrl = screen
    ? `${shellPath}${shellPath.includes("?") ? "&" : "?"}screen=${encodeURIComponent(screen.object)}&view=${encodeURIComponent(screen.view)}`
    : shellPath;

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
      if (message.type === "ready") {
        sendTheme();
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
      try {
        const data = await apiFetch<unknown>(
          "/api" + message.path,
          message.body === undefined
            ? { method: message.method ?? "GET" }
            : {
                method: message.method ?? "GET",
                body: JSON.stringify(message.body),
              },
        );
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
  }, []);

  return (
    <iframe
      ref={frameRef}
      src={shellUrl}
      sandbox="allow-scripts"
      title={title}
      className={`w-full rounded-md border bg-background ${heightClassName}`}
    />
  );
}
