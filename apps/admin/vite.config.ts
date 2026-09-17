import { reactSandboxPlugin } from "./build/react-sandbox-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    reactSandboxPlugin(),
    precompressionPlugin(),
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
