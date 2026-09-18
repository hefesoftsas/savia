import { reactSandboxPlugin } from "./build/react-sandbox-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

function precompressionPlugin(): Plugin {
  return {
    name: "savia-precompression",
    apply: "build",
    closeBundle() {
      const distDir = fileURLToPath(new URL("./dist", import.meta.url));
      function processDir(dir: string) {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              processDir(fullPath);
            } else if (
              entry.isFile() &&
              (entry.name.endsWith(".js") ||
                entry.name.endsWith(".css") ||
                entry.name.endsWith(".html") ||
                entry.name.endsWith(".svg")) &&
              !entry.name.endsWith(".gz") &&
              !entry.name.endsWith(".br")
            ) {
              const content = readFileSync(fullPath);
              if (content.length >= 1024) {
                const gz = gzipSync(content, { level: 9 });
                writeFileSync(`${fullPath}.gz`, gz);
                const br = brotliCompressSync(content, {
                  params: {
                    [constants.BROTLI_PARAM_QUALITY]: 11,
                  },
                });
                writeFileSync(`${fullPath}.br`, br);
              }
            }
          }
        } catch {
          // ignore directory access errors during closeBundle
        }
      }
      processDir(distDir);
    },
  };
}

// Include the CRM route and its static dependencies without precaching the
// thousands of optional icon/editor chunks shipped by the application.
const offlineShellAssets = new Map<string, number>();
function offlineShellPlugin(): Plugin {
  return {
    name: "savia-offline-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      offlineShellAssets.clear();
      const visit = (name: string) => {
        if (offlineShellAssets.has(name)) return;
        const item = bundle[name];
        if (!item || item.type !== "chunk") return;
        offlineShellAssets.set(name, Buffer.byteLength(item.code));
        item.imports.forEach(visit);
      };
      for (const item of Object.values(bundle)) {
        if (
          item.type === "chunk" &&
          (item.isEntry ||
            item.facadeModuleId?.endsWith("/dynamic-crm/crm-page.tsx") ||
            item.facadeModuleId?.endsWith("/crm-engine/app.tsx"))
        )
          visit(item.fileName);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    reactSandboxPlugin(),
    precompressionPlugin(),
    offlineShellPlugin(),
    // App shell precache for airplane-mode boot. Data stays in the Dexie
    // collection replica: no runtime caching of /v1/* here, so no API
    // payload (or credential-adjacent response) ever lands in Cache Storage.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      workbox: {
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/v1/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Precache only the boot shell: dist ships ~9k chunks (43 MB),
        // precaching all of it would tax first visits. Remaining
        // same-origin assets cache on first use below.
        globPatterns: [
          "index.html",
          "assets/index-*.js",
          "assets/*.css",
          "*.{ico,png,svg,webp,webmanifest}",
        ],
        manifestTransforms: [
          async (entries) => ({
            manifest: [
              ...entries,
              ...[...offlineShellAssets]
                .filter(([url]) => !entries.some((entry) => entry.url === url))
                .map(([url, size]) => ({ url, size, revision: null })),
            ],
            warnings: [],
          }),
        ],
        runtimeCaching: [
          {
            // Same-origin app assets only. /v1/* and /api/* are excluded
            // on purpose: API payloads live in scoped IndexedDB replicas,
            // never in Cache Storage.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin &&
              !url.pathname.startsWith("/v1") &&
              !url.pathname.startsWith("/api") &&
              (url.pathname.startsWith("/assets/") ||
                /\.(js|css|woff2?|ttf|eot)$/.test(url.pathname)),
            handler: "CacheFirst",
            options: {
              cacheName: "savia-shell",
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react-router",
      "react-router-dom",
      "ra-core",
      "@tanstack/react-query",
      "sonner",
    ],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@thesvg-icon-dist": fileURLToPath(
        new URL("./node_modules/@thesvg/react/dist", import.meta.url),
      ),
      "@lucide-icon-dist": fileURLToPath(
        new URL("./node_modules/lucide-react/dist/esm/icons", import.meta.url),
      ),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // manualChunks removed
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/v1": "http://127.0.0.1:8787",
      "/.well-known": "http://127.0.0.1:8787",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
