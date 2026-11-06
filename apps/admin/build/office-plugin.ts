import type { Plugin } from "vite";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  officeDocumentHeaders,
  officeRuntimeAsset,
} from "../src/office-gateway";
export function officePlugin(): Plugin {
  return {
    name: "savia-office",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        if (path.startsWith("/office/runtime/")) {
          const asset = officeRuntimeAsset(path);
          const file = asset
            ? join(
                fileURLToPath(new URL("../../../.cache/", import.meta.url)),
                asset.key,
              )
            : "";
          if (!asset || !existsSync(file)) {
            res.statusCode = asset ? 503 : 404;
            res.end(
              "Office runtime unavailable. Run node scripts/prepare-office-runtime.mjs",
            );
            return;
          }
          res.setHeader("Content-Type", asset.type);
          res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          res.setHeader("Content-Length", statSync(file).size);
          createReadStream(file).pipe(res);
          return;
        }
        if (path === "/office" || path.startsWith("/office/"))
          for (const [k, v] of Object.entries(officeDocumentHeaders))
            res.setHeader(k, v);
        next();
      });
    },
  };
}
