// Shared helpers to consume `pulumi stack output --json`.
// Both render-from-outputs.mjs (deploy) and destroy.mjs (bucket emptying)
// read the live stack instead of duplicating bucket names, so a renamed
// bucket never desynchronizes the scripts.
import {
  exportsForRender,
  resolveInfraNames,
  validateFlowsResources,
  assertAccountId,
} from "./naming.mjs";

const REQUIRED_OUTPUTS = [
  "cloudflareAccountId",
  "authD1Id",
  "domainD1Id",
  "documentsBucketName",
  "resolvedEnvironment",
  "resolvedPublicOrigin",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Stack outputs are missing ${label}`);
  }
  return value.trim();
}

function assertNamedValues(actual, expected, label) {
  if (!isRecord(actual)) throw new Error(`Stack outputs are missing ${label}`);
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    const matches = isRecord(expectedValue)
      ? isRecord(actualValue) &&
        Object.entries(expectedValue).every(
          ([childKey, childValue]) => actualValue[childKey] === childValue,
        )
      : actualValue === expectedValue;
    if (!matches) {
      throw new Error(
        `Stack output ${label}.${key} does not match the resolved environment`,
      );
    }
  }
}

function validateStackOutputs(parsed) {
  for (const key of REQUIRED_OUTPUTS) {
    requireNonEmptyString(parsed?.[key], key);
  }
  assertAccountId(parsed.cloudflareAccountId);
  const resolvedEnvironment = parsed.resolvedEnvironment;
  const names = resolveInfraNames({
    environment: resolvedEnvironment,
    documentsBucket: parsed.documentsBucketName,
    publicOrigin: parsed.resolvedPublicOrigin,
    pagesSearchIndex: parsed.vectorizeIndex,
    ...(resolvedEnvironment === "production"
      ? {
          authDatabaseName: parsed.databaseNames?.auth,
          domainDatabaseName: parsed.databaseNames?.domain,
        }
      : {}),
  });
  requireNonEmptyString(parsed.authD1Id, "authD1Id");
  requireNonEmptyString(parsed.domainD1Id, "domainD1Id");
  assertNamedValues(parsed.workerNames, names.workers, "workerNames");
  assertNamedValues(parsed.databaseNames, names.databases, "databaseNames");
  // Pre-DLQ stacks exported only planned names while Flows was disabled.
  // Normalize that single absent name so bootstrap can read state before up;
  // active stacks and any explicit mismatched name still fail closed.
  if (
    parsed.flowsEnabled === false &&
    parsed.flowsResources === null &&
    (parsed.flowsExecutionEnabled ?? false) === false &&
    isRecord(parsed.plannedFlowsResourceNames) &&
    !Object.hasOwn(parsed.plannedFlowsResourceNames, "deadLetterQueue")
  ) {
    parsed = {
      ...parsed,
      plannedFlowsResourceNames: {
        ...parsed.plannedFlowsResourceNames,
        deadLetterQueue: names.flows.deadLetterQueue,
      },
    };
  }
  assertNamedValues(
    parsed.plannedFlowsResourceNames,
    names.flows,
    "plannedFlowsResourceNames",
  );

  if (typeof parsed.flowsEnabled !== "boolean") {
    throw new Error("Stack outputs are missing flowsEnabled");
  }
  const flowsExecutionEnabled = parsed.flowsExecutionEnabled ?? false;
  if (
    typeof flowsExecutionEnabled !== "boolean" ||
    (flowsExecutionEnabled && !parsed.flowsEnabled)
  ) {
    throw new Error("Invalid flowsExecutionEnabled output");
  }
  parsed = { ...parsed, flowsExecutionEnabled };
  if (!parsed.flowsEnabled) {
    if (parsed.flowsResources !== null) {
      throw new Error("Disabled Flows must not have provisioned resources");
    }
    return Object.freeze({ ...parsed });
  }

  if (parsed.flowsResources === null || parsed.flowsResources === undefined) {
    throw new Error("Enabled Flows stack outputs are missing flowsResources");
  }
  validateFlowsResources(parsed.flowsResources, resolvedEnvironment);
  return Object.freeze({ ...parsed });
}

export function parseStackOutputs(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(String(jsonText));
  } catch {
    throw new Error("Stack outputs are not valid JSON");
  }
  return validateStackOutputs(parsed);
}

export function assertDeploymentAccount(outputs, runtimeAccountId) {
  const account = assertAccountId(runtimeAccountId);
  if (outputs.cloudflareAccountId !== account)
    throw new Error(
      "Pulumi account must match the Cloudflare Worker publisher account",
    );
}

// Builds the env consumed by scripts/render-cloudflare-production-config.mjs.
export function renderEnvFromOutputs(outputs, outputRoot) {
  const validated = validateStackOutputs(outputs);
  const names = {
    bucket: validated.documentsBucketName,
    publicOrigin: validated.resolvedPublicOrigin,
    environment: validated.resolvedEnvironment,
    databases: validated.databaseNames,
  };
  const searchIndex =
    typeof validated.vectorizeIndex === "string" &&
    validated.vectorizeIndex.trim() !== ""
      ? validated.vectorizeIndex.trim()
      : null;
  return Object.freeze({
    SAVIA_CLOUDFLARE_ACCOUNT_ID: validated.cloudflareAccountId,
    ...exportsForRender({
      authD1Id: validated.authD1Id,
      domainD1Id: validated.domainD1Id,
      names,
    }),
    // Empty values override inherited variables so disabled services cannot activate.
    SAVIA_PAGES_SEARCH_INDEX: searchIndex ?? "",
    SAVIA_FLOWS_RESOURCES: validated.flowsEnabled
      ? JSON.stringify(validated.flowsResources)
      : "",
    SAVIA_FLOWS_PROVISIONED: String(validated.flowsEnabled),
    SAVIA_FLOWS_EXECUTION_ENABLED: String(validated.flowsExecutionEnabled),
    SAVIA_DEPLOY_CONFIG_ROOT: outputRoot,
  });
}
