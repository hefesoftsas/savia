import assert from "node:assert/strict";
import { access } from "node:fs/promises";

await assert.rejects(
  access(
    new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url),
  ),
  { code: "ENOENT" },
);
console.log("Production application deployment workflow is retired");
