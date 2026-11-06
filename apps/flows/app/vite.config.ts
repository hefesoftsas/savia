import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const ReactCompilerConfig = {};

// https://vite.dev/config/
export default defineConfig({
  base: "/flows-ui/",
  build: {
    // The catalog's icon and viewer modules create a broad dependency graph.
    // Bound open files on local machines shared with other development tools.
    rollupOptions: { maxParallelFileOps: 8 },
  },
  plugins: [
    tailwindcss(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "lucide-react/icons": path.resolve(
        __dirname,
        "node_modules/lucide-react/dist/esm/icons",
      ),
    },
  },
});
