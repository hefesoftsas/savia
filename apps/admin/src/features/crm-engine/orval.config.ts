import { defineConfig } from "orval";
export default defineConfig({
  crm: {
    input: "src/features/crm-engine/openapi.json",
    output: {
      target: "src/features/crm-engine/generated/crm.ts",
      client: "react-query",
      httpClient: "fetch",
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: "src/features/crm-engine/api.ts", name: "apiFetch" },
      },
    },
  },
});
