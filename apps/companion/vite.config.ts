import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/artifacts/**"] },
  },
  build: { target: ["safari15", "chrome105"] },
});
