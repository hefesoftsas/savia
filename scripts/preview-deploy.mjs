import { fileURLToPath } from "node:url";
export {
  workerConfig,
  workerDeploymentOrder,
  execFileWithInput,
  parseWorkersDevUrl,
  requireGatewayOrigin,
} from "../infra/pulumi/runtime-publisher-branch.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  import("../infra/pulumi/environment-branch.mjs")
    .then(({ runBranchDeployment }) =>
      runBranchDeployment(process.argv.slice(2)),
    )
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
