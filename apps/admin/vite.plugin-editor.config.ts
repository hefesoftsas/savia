import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/",
  publicDir: false,
  define: { "import.meta.env.SAVIA_ISOLATED_PLUGIN_EDITOR_BUILD": "true" },
  build: {
    outDir: "dist-plugin-editor",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: fileURLToPath(new URL("./plugin-editor.html", import.meta.url)),
    },
  },
});
