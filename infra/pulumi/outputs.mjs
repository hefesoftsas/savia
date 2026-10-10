// Shared helpers to consume `pulumi stack output --json`.
// Both render-from-outputs.mjs (deploy) and destroy.mjs (bucket emptying)
// read the live stack instead of duplicating bucket names, so a renamed
// bucket never desynchronizes the scripts.
import { exportsForRender } from "./naming.mjs";

const REQUIRED_OUTPUTS = [
  "authD1Id",
  "domainD1Id",
  "documentsBucketName",
  "resolvedEnvironment",
  "resolvedPublicOrigin",
];

export function parseStackOutputs(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(String(jsonText));
  } catch {
    throw new Error("Stack outputs are not valid JSON");
  }
  for (const key of REQUIRED_OUTPUTS) {
    if (typeof parsed?.[key] !== "string" || parsed[key].trim() === "") {
      throw new Error(`Stack outputs are missing ${key}`);
    }
  }
  if (
    !parsed?.databaseNames ||
    typeof parsed.databaseNames !== "object" ||
    typeof parsed.databaseNames.auth !== "string" ||
    typeof parsed.databaseNames.domain !== "string"
  ) {
    throw new Error("Stack outputs are missing databaseNames");
  }
  return Object.freeze({ ...parsed });
}

// Builds the env consumed by scripts/render-cloudflare-production-config.mjs.
export function renderEnvFromOutputs(outputs, outputRoot) {
  const names = {
    bucket: outputs.documentsBucketName,
    publicOrigin: outputs.resolvedPublicOrigin,
    environment: outputs.resolvedEnvironment,
  };
  return Object.freeze({
    ...exportsForRender({
      authD1Id: outputs.authD1Id,
      domainD1Id: outputs.domainD1Id,
      names,
    }),
    SAVIA_DEPLOY_CONFIG_ROOT: outputRoot,
  });
}
