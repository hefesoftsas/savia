import { companionDownloadsResponse } from "./src/companion-downloads-catalog";
import { PUBLIC_VISITOR_ROUTE_DENYLIST } from "./src/pwa/deployment-recovery";
import { pluginDevelopmentReload } from "./build/plugin-development";
import { officePlugin } from "./build/office-plugin";
import { collectOfflineShellAssets } from "./build/offline-shell-assets";
import { reactSandboxPlugin } from "./build/react-sandbox-plugin";
import { pluginIdeRuntimePlugin } from "./build/plugin-ide-runtime";
import { compactBrandIcons } from "./build/compact-brand-icons";
import { saviaManualChunk } from "./build/manual-chunks";
import { flowsPlugin } from "./build/flows-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Include the CRM route and its static dependencies without precaching the
// thousands of optional icon/editor chunks shipped by the application.
const offlineShellAssets = new Map<string, number>();
function offlineShellPlugin(): Plugin {
  return {
    name: "savia-offline-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      offlineShellAssets.clear();
      for (const [name, size] of collectOfflineShellAssets(bundle)) {
        offlineShellAssets.set(name, size);
      }
    },
  };
}

const devApiTarget = process.env.SAVIA_DEV_API_URL || "http://127.0.0.1:8787";
// Keep the browser's public origin for CSRF checks, authentication redirects,
// and editor socket URLs, including the default local API on a different port.
const devChangeOrigin = false;

export default defineConfig({
  plugins: [
    compactBrandIcons(),
    {
      name: "companion-download-catalog",
      configureServer(server) {
        server.middlewares.use(
          "/companion-downloads.json",
          async (request, response) => {
            const result = await companionDownloadsResponse(
              new Request("http://localhost/companion-downloads.json", {
                method: request.method,
              }),
            );
            response.statusCode = result.status;
            result.headers.forEach((value, name) =>
              response.setHeader(name, value),
            );
            response.end(await result.text());
          },
        );
      },
    },
    react(),
    flowsPlugin(),
    pluginDevelopmentReload(),
    officePlugin(),
    tailwindcss(),
    reactSandboxPlugin(),
    pluginIdeRuntimePlugin(),
    offlineShellPlugin(),
    // App shell precache for airplane-mode boot. Data stays in the Dexie
    // collection replica: no runtime caching of /v1/* here, so no API
    // payload (or credential-adjacent response) ever lands in Cache Storage.
    VitePWA({
      registerType: "autoUpdate",
      // Only the private bootstrap registers a worker; public visitors must not
      // download the administrative offline shell.
      injectRegister: false,
      manifest: false,
      workbox: {
        // Manual registration disables the plugin's autoUpdate defaults.
        // Activate the replacement shell even while existing tabs are open;
        // DeploymentUpdateNotice lets the user choose when to reload the page.
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/api/,
          /^\/v1/,
          ...PUBLIC_VISITOR_ROUTE_DENYLIST,
          /^\/s\/p(?:\/|\?|$)/,
          /^\/register(?:\/|\?|$)/,
          /^\/office(?:\/|$)/,
          /^\/plugin-editor(?:\.html)?(?:\/|\?|$)/,
          /^\/flows-ui(?:\/|\?|$)/,
        ],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Precache only the boot shell: dist ships ~9k chunks (43 MB),
        // precaching all of it would tax first visits. Remaining
        // same-origin assets cache on first use below.
        globIgnores: ["assets/plugin-editor-vendor-*.js"],
        globPatterns: [
          "index.html",
          "assets/*.js",
          "assets/*.css",
          "*.{ico,png,svg,webp,webmanifest}",
        ],
        manifestTransforms: [
          async (entries) => {
            // dist ships thousands of lazy chunks: precaching `assets/*.js`
            // verbatim forces every deployment to download tens of MB before
            // the replacement worker can activate, which times out the
            // post-deploy recovery on mobile networks. Keep only the boot
            // shell closure (+ index, css, top-level statics); the rest stays
            // on-demand via runtimeCaching.
            const shell = new Set(offlineShellAssets.keys());
            const manifest = [
              ...entries.filter((entry) => {
                if (entry.url === "index.html") return true;
                if (shell.has(entry.url)) return true;
                // The embedded Flows bundle is served as a separate child
                // application and loads on demand through /flows-ui/*.
                if (entry.url.startsWith("flows-ui/")) return false;
                if (!entry.url.startsWith("assets/")) return true;
                // Boot CSS is not part of the JS closure walk; it stays
                // precached (few small files) so first paint is styled.
                if (entry.url.endsWith(".css")) return true;
                return false;
              }),
              ...[...offlineShellAssets]
                .filter(([url]) => !entries.some((entry) => entry.url === url))
                .map(([url, size]) => ({ url, size, revision: null })),
            ];
            return { manifest, warnings: [] };
          },
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
              !url.pathname.startsWith("/office/") &&
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
      devOptions: {
        enabled: true,
        type: "module",
      },
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
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        pluginEditor: fileURLToPath(
          new URL("./plugin-editor.html", import.meta.url),
        ),
        office: fileURLToPath(new URL("./office/index.html", import.meta.url)),
      },
      output: {
        // Agrupa vendors compartidos para evitar decenas de chunks
        // diminutos (un icono = un roundtrip de ~130ms en el HAR).
        // El código de rutas sigue con code-splitting por lazy().
        // Excepción: los iconos de lookup por `import.meta.glob`
        // (lucide dist/esm/icons, @thesvg dist) DEBEN quedar divididos:
        // fusionarlos crea un único chunk eager de ~32 MB.
        manualChunks: saviaManualChunk,
      },
    },
  },
  server: {
    proxy: {
      // `ws: true` is required so the realtime WebSocket
      // (/v1/realtime/subscribe) reaches the API through the dev server
      // instead of failing and leaving LiveIndicator stuck on connecting.
      "/api": {
        target: devApiTarget,
        changeOrigin: devChangeOrigin,
        ws: true,
      },
      "/v1": {
        target: devApiTarget,
        changeOrigin: devChangeOrigin,
        ws: true,
      },
      "^/s/": {
        target: devApiTarget,
        changeOrigin: devChangeOrigin,
      },
      "/.well-known": {
        target: devApiTarget,
        changeOrigin: devChangeOrigin,
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
