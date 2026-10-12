import { fileURLToPath } from "node:url";
import { runPreviewPagesSearchFromEnv } from "../infra/pulumi/vectorize.mjs";
export { ensurePreviewPagesSearch } from "../infra/pulumi/vectorize.mjs";
if (process.argv[1] === fileURLToPath(import.meta.url))
  runPreviewPagesSearchFromEnv().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
