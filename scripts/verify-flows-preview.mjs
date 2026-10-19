import { fileURLToPath } from "node:url";
import { validateFlowsWorkerSettings } from "./flows-preview-policy.mjs";
export async function verifyFlows(env = process.env, fetcher = fetch) {
  if (env.SAVIA_FLOWS_PROVISIONED !== "true") return { skipped: true };
  const environment = env.SAVIA_DEPLOY_ENVIRONMENT ?? "preview";
  if (!["preview", "production"].includes(environment))
    throw new Error("Flows verification environment is invalid");
  const suffix = environment === "preview" ? "-preview" : "";
  if (
    !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN
  )
    throw new Error("Cloudflare verification credentials missing");
  const get = async (path) => {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`,
      { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
    );
    if (!response.ok)
      throw new Error(
        `Flows ${environment} verification failed (${response.status})`,
      );
    return response;
  };
  const settings = await (
    await get(`/workers/scripts/savia-flows${suffix}/settings`)
  ).json();
  if (!settings.success) throw new Error("Flows settings unavailable");
  validateFlowsWorkerSettings(
    settings.result,
    env.SAVIA_FLOWS_EXECUTION_ENABLED === "true",
    environment,
  );
  const executor = await (
    await get(`/workers/scripts/savia-hook-executor${suffix}`)
  ).text();
  if (!executor.includes("FlowsExecutor"))
    throw new Error("Published QuickJS executor is missing FlowsExecutor");
  return {
    skipped: false,
    executionEnabled: env.SAVIA_FLOWS_EXECUTION_ENABLED === "true",
  };
}
export async function verifyFlowsPreview(env = process.env, fetcher = fetch) {
  return verifyFlows({ ...env, SAVIA_DEPLOY_ENVIRONMENT: "preview" }, fetcher);
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  verifyFlows()
    .then((result) =>
      console.log(
        result.skipped
          ? "Flows preview remains unprovisioned."
          : "Flows preview bindings, quotas and execution policy verified.",
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
