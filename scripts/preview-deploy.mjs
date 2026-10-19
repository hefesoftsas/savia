import { fileURLToPath } from "node:url";
import { publishBranchPreview } from "../infra/pulumi/runtime-publisher-branch.mjs";
export {
  workerConfig,
  workerDeploymentOrder,
  execFileWithInput,
  parseWorkersDevUrl,
  requireGatewayOrigin,
} from "../infra/pulumi/runtime-publisher-branch.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishBranchPreview().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
