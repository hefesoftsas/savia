export default {
  optimizeDeps: { exclude: ["@surrealdb/wasm"] },
  worker: { format: "es" },
  build: { target: "esnext" },
  server: { host: "127.0.0.1", port: 5184, strictPort: true },
};
