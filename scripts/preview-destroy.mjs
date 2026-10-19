import { fileURLToPath } from "node:url";

export function workerOrder(names) {
  return [
    names.workers.gateway,
    names.workers.api,
    names.workers.connectorGateway,
    names.workers.mcp,
    names.workers.request,
    names.workers.hookExecutor,
    names.workers.auth,
  ];
}

export function isAlreadyGone(error) {
  return /not found|does not exist|no such|404/i.test(
    String(error.stderr ?? error.stdout ?? error.message),
  );
}

async function main() {
  const { runLegacyDestroy } =
    await import("../infra/pulumi/environment-compat.mjs");
  console.log(
    JSON.stringify(
      await runLegacyDestroy("branch", process.argv.slice(2)),
      null,
      2,
    ),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
