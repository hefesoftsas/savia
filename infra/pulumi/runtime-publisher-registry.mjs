import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyRuntimeArtifact } from "./runtime-publisher.mjs";

export async function publishRegistryRuntime(
  inputs,
  { env = process.env, runWrangler },
) {
  if (
    inputs.environment !== "shared" ||
    inputs.workers.length !== 1 ||
    inputs.workers[0].name !== "savia-plugin-registry"
  )
    throw new Error("Registry publication requires the exact shared Worker");
  if (env.CLOUDFLARE_ACCOUNT_ID !== inputs.accountId)
    throw new Error("Shared registry account mismatch");
  let credentials;
  const raw = env.REGISTRY_CREDENTIALS ?? env.PLUGIN_REGISTRY_CREDENTIALS;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("Missing registry credentials");
  }
  if (!Array.isArray(credentials) || !credentials.length)
    throw new Error("Missing registry credentials");
  const artifact = await verifyRuntimeArtifact(inputs);
  if (artifact.configs.length !== 1)
    throw new Error("Registry requires one prepared configuration");
  const file = join(inputs.artifactDirectory, artifact.configs[0]);
  const config = JSON.parse(await readFile(file, "utf8"));
  if (
    config.name !== "savia-plugin-registry" ||
    !config.r2_buckets?.some(
      (binding) => binding.bucket_name === "savia-plugin-registry",
    )
  )
    throw new Error("Unexpected registry publication target");
  const options = { env, cwd: inputs.artifactDirectory };
  // Existing secret custody stays in the protected GitHub environment. The
  // credential payload never becomes a command argument or provider output.
  await runWrangler(["secret", "bulk", "--config", file], {
    ...options,
    input: JSON.stringify({ REGISTRY_CREDENTIALS: raw }),
  });
  await runWrangler(["deploy", "--config", file], options);
  await runWrangler(
    [
      "deployments",
      "status",
      "--name",
      "savia-plugin-registry",
      "--config",
      file,
    ],
    options,
  );
}
