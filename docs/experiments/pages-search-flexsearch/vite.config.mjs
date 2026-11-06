export default {
  worker: { format: "es" },
  build: {
    target: "esnext",
    rollupOptions: { input: ["index.html", "memory.html"] },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    host: "127.0.0.1",
    port: 5184,
    strictPort: true,
  },
};
