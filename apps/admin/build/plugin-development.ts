import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const reloadEvent = "savia:plugin-development-reload";

/** The local CLI writes this marker only after a successful installation. */
export function pluginDevelopmentReload(): Plugin {
  const marker = fileURLToPath(
    new URL(
      "../../api/.wrangler/local-runtime/plugin-reload.json",
      import.meta.url,
    ),
  );
  return {
    name: "savia-plugin-development",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(marker);
      const reload = async (path: string) => {
        if (resolve(path) !== marker) return;
        try {
          const data: unknown = JSON.parse(await readFile(marker, "utf8"));
          if (
            !data ||
            typeof data !== "object" ||
            !Number.isSafeInteger((data as { tenant?: unknown }).tenant)
          )
            return;
          server.ws.send({ type: "custom", event: reloadEvent, data });
        } catch {
          // The marker is only a local reload signal; a later write can retry.
        }
      };
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
      server.httpServer?.once("close", () => {
        server.watcher.off("change", reload);
        server.watcher.off("add", reload);
      });
    },
  };
}
