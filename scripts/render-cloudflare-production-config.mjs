// Compatibility entrypoint. Infrastructure declarations live in infra/pulumi.
import { fileURLToPath } from "node:url";
import { renderCloudflareConfigFromEnv } from "../infra/pulumi/worker-config.mjs";
export { renderProductionConfigs } from "../infra/pulumi/worker-config.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  renderCloudflareConfigFromEnv().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
