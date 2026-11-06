import { fileURLToPath } from "node:url";
import { normalizeEnvironment } from "./naming.mjs";

export function parseDeployArgs(argv) {
  const index = argv.indexOf("--stack");
  const stack = normalizeEnvironment(index >= 0 ? argv[index + 1] : undefined);
  const apply = argv.includes("--apply");
  if (apply === argv.includes("--preview"))
    throw new Error("Choose exactly one of --apply or --preview");
  return { stack, apply };
}

export function assertBackendConfigured(env) {
  if (!env.PULUMI_BACKEND_URL) throw new Error("Pulumi backend is required");
  const url = new URL(env.PULUMI_BACKEND_URL);
  if (url.protocol !== "s3:" || url.username || url.password)
    throw new Error(
      "A remote S3-compatible state backend without URL credentials is required",
    );
  if (!env.PULUMI_CONFIG_PASSPHRASE)
    throw new Error("Encrypted-state passphrase is required");
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY)
    throw new Error("R2 state backend credentials are required");
}

export function assertSafePlan(plan) {
  const changes = plan?.changeSummary;
  if (!changes || typeof changes !== "object")
    throw new Error("Invalid Pulumi plan summary");
  for (const [operation, count] of Object.entries(changes)) {
    if (typeof count !== "number" || count < 0)
      throw new Error("Invalid Pulumi plan count");
    if (
      count > 0 &&
      ![
        "same",
        "create",
        "update",
        "read",
        "refresh",
        "read-discard",
        "import",
      ].includes(operation)
    )
      throw new Error(`Refusing destructive infrastructure plan: ${operation}`);
  }
}

async function main() {
  const { runLegacyInfrastructure } = await import("./environment-compat.mjs");
  console.log(
    JSON.stringify(
      await runLegacyInfrastructure(process.argv.slice(2)),
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
