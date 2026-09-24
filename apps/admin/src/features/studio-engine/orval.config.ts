import { defineConfig } from "orval";
export default defineConfig({
  studio: {
    input: "./openapi.json",
    output: {
      target: "./generated/studio.ts",
      client: "react-query",
      httpClient: "fetch",
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: "./api.ts", name: "apiFetch" },
      },
    },
  },
});
