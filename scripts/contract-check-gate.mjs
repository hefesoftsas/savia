import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CI_KINDS = new Set([
  "full",
  "infrastructure",
  "plugin",
  "none",
  "auth",
  "api",
  "backup-gate",
]);
const RELEASE_KINDS = new Set(["platform", "plugin", "none"]);
const RUNTIME_PROFILE_KINDS = new Set(["auth", "api", "backup-gate"]);

export function evaluateContractGate(needs) {
  const failures = [];
  const changes = needs?.changes;
  if (changes?.result !== "success") {
    failures.push(
      `change classification result was ${changes?.result ?? "missing"}`,
    );
  }

  const kind = changes?.outputs?.kind;
  const ciKind = changes?.outputs?.ci_kind;
  if (!RELEASE_KINDS.has(kind)) {
    failures.push(
      `change classification release kind was invalid: ${kind ?? "missing"}`,
    );
  }
  if (!CI_KINDS.has(ciKind)) {
    failures.push(
      `change classification CI kind was invalid: ${ciKind ?? "missing"}`,
    );
  }

  const contractSuiteResult = needs?.["contract-suite"]?.result;
  if (contractSuiteResult !== "success") {
    failures.push(
      `contract suite result was ${contractSuiteResult ?? "missing"}`,
    );
  }

  if (kind === "plugin") {
    const result = needs?.["plugin-validation"]?.result;
    if (result !== "success") {
      failures.push(`plugin validation result was ${result ?? "missing"}`);
    }
  }

  if (RUNTIME_PROFILE_KINDS.has(ciKind)) {
    const result = needs?.["runtime-profile"]?.result;
    if (result !== "success") {
      failures.push(`runtime profile result was ${result ?? "missing"}`);
    }
  }

  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let needs;
  try {
    needs = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    console.error(`Could not read required CI job results: ${error.message}`);
    process.exitCode = 1;
  }
  if (!needs || typeof needs !== "object" || Array.isArray(needs)) {
    console.error("Required CI job results must be a JSON object.");
    process.exitCode = 1;
  } else {
    const failures = evaluateContractGate(needs);
    if (failures.length > 0) {
      console.error(`Required CI checks failed: ${failures.join("; ")}`);
      process.exitCode = 1;
    }
  }
}
