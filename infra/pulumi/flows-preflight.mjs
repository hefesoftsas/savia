import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildFlowsSecretUploads } from "../../scripts/flows-preview-policy.mjs";
const exec = promisify(execFile);

export function validatePlannedFlows(
  { provisioned, executionEnabled },
  env,
  environment = "preview",
) {
  if (
    typeof provisioned !== "boolean" ||
    typeof executionEnabled !== "boolean" ||
    (executionEnabled && !provisioned)
  )
    throw new Error("Invalid planned Flows settings");
  if (env.SAVIA_FLOWS_PROVISIONED === "true" && !provisioned)
    throw new Error(
      "Keep flowsEnabled true to preserve data; pause with flowsExecutionEnabled",
    );
  if (
    env.SAVIA_FLOWS_PROVISIONED === "true" &&
    !/^[a-f0-9]{64}$/i.test(env.SAVIA_FLOWS_BACKUP_KEY ?? "")
  )
    throw new Error(
      "SAVIA_FLOWS_BACKUP_KEY is required for encrypted recovery artifacts",
    );
  buildFlowsSecretUploads(environment, {
    ...env,
    SAVIA_FLOWS_PROVISIONED: String(provisioned),
  });
  return {
    SAVIA_FLOWS_PLANNED: String(provisioned),
    SAVIA_FLOWS_PLANNED_EXECUTION_ENABLED: String(executionEnabled),
  };
}
async function main() {
  const cwd = fileURLToPath(new URL(".", import.meta.url));
  const stackIndex = process.argv.indexOf("--stack");
  const stack = stackIndex === -1 ? "preview" : process.argv[stackIndex + 1];
  if (
    !["preview", "production"].includes(stack) ||
    (stackIndex >= 0 &&
      (process.argv.length !== stackIndex + 2 ||
        !process.argv[stackIndex + 1] ||
        process.argv[stackIndex + 1].startsWith("--")))
  )
    throw new Error("Use --stack preview|production");
  const readBoolean = async (key) => {
    try {
      const { stdout } = await exec(
        "pulumi",
        ["config", "get", key, "--stack", stack],
        { cwd },
      );
      const value = stdout.trim();
      if (!["true", "false"].includes(value))
        throw new Error(`Invalid Pulumi boolean ${key}`);
      return value === "true";
    } catch (error) {
      if (
        String(error.stderr ?? "").includes("configuration key") &&
        String(error.stderr).includes("not found")
      )
        return false;
      throw new Error(`Unable to read planned Flows setting ${key}`);
    }
  };
  const outputs = validatePlannedFlows(
    {
      provisioned: await readBoolean("flowsEnabled"),
      executionEnabled: await readBoolean("flowsExecutionEnabled"),
    },
    process.env,
    stack,
  );
  if (process.env.GITHUB_ENV)
    await appendFile(
      process.env.GITHUB_ENV,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  console.log(
    `Flows deployment preflight passed; provisioning=${outputs.SAVIA_FLOWS_PLANNED}, execution=${outputs.SAVIA_FLOWS_PLANNED_EXECUTION_ENABLED}.`,
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
