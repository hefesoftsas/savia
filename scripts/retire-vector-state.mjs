import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TARGET_URN =
  "urn:pulumi:preview::savia-cloudflare::pulumi-nodejs:dynamic/vectorize:Index::pages-search";
const TARGET_NAME = "savia-pages-search-preview";
const TARGET_TYPE = "pulumi-nodejs:dynamic/vectorize:Index";
const STACK_URN =
  "urn:pulumi:preview::savia-cloudflare::pulumi:pulumi:Stack::savia-cloudflare-preview";
const PROVIDER_URN =
  "urn:pulumi:preview::savia-cloudflare::pulumi:providers:pulumi-nodejs::default";
const RUNTIME_URN =
  "urn:pulumi:preview::savia-cloudflare::pulumi-nodejs:dynamic/runtime:RuntimeRelease::runtime";

function assertTargetUrn(targetUrn) {
  if (targetUrn !== TARGET_URN)
    throw new Error("target URN does not match the fixed preview index");
}

function getResources(checkpoint) {
  const resources =
    checkpoint?.deployment?.resources ??
    checkpoint?.checkpoint?.latest?.resources ??
    checkpoint?.resources;
  if (!Array.isArray(resources))
    throw new Error("checkpoint has no resource list");
  return resources;
}

function setResources(checkpoint, resources) {
  if (Array.isArray(checkpoint?.deployment?.resources))
    checkpoint.deployment.resources = resources;
  else if (Array.isArray(checkpoint?.checkpoint?.latest?.resources))
    checkpoint.checkpoint.latest.resources = resources;
  else if (Array.isArray(checkpoint?.resources))
    checkpoint.resources = resources;
  else throw new Error("checkpoint has no supported resource list");
}

function getPendingOperations(checkpoint) {
  return (
    checkpoint?.deployment?.pending_operations ??
    checkpoint?.checkpoint?.latest?.pending_operations ??
    checkpoint?.pending_operations ??
    []
  );
}

function exactlyOne(resources, predicate, message) {
  const matches = resources.filter(predicate);
  if (matches.length !== 1) throw new Error(message);
  return matches[0];
}

function targetEntry(entry) {
  return (
    entry?.kind === "vectorize" &&
    entry.name === TARGET_NAME &&
    entry.cloudId === TARGET_NAME
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function sameJson(left, right) {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function validateTargetInCheckpoint(
  checkpoint,
  { targetUrn = TARGET_URN } = {},
) {
  assertTargetUrn(targetUrn);
  const target = exactlyOne(
    getResources(checkpoint),
    (resource) => resource.urn === targetUrn,
    "checkpoint must contain exactly one target index",
  );
  const name = target.inputs?.name ?? target.outputs?.name;
  if (
    target.type !== TARGET_TYPE ||
    name !== TARGET_NAME ||
    typeof target.id !== "string" ||
    !target.id.endsWith(`/${TARGET_NAME}`) ||
    target.protect !== true
  ) {
    throw new Error("checkpoint target is not the expected protected index");
  }
  return true;
}

function findStringPaths(value, needle, path, result = []) {
  if (typeof value === "string") {
    if (value.includes(needle)) result.push(path);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      findStringPaths(child, needle, `${path}[${index}]`, result),
    );
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value))
      findStringPaths(child, needle, path ? `${path}.${key}` : key, result);
  }
  return result;
}

function findTargetReferences(checkpoint, targetUrn = TARGET_URN) {
  const paths = [];
  for (const resource of getResources(checkpoint)) {
    if (resource.urn === targetUrn) {
      paths.push(`${resource.urn} (resource)`);
      continue;
    }
    paths.push(...findStringPaths(resource, TARGET_NAME, resource.urn));
    paths.push(...findStringPaths(resource, targetUrn, resource.urn));
  }
  return [...new Set(paths)];
}

function removeManifestEntry(value, path, report) {
  const wasString = typeof value === "string";
  let manifest;
  try {
    manifest = wasString ? JSON.parse(value) : structuredClone(value);
  } catch {
    throw new Error(`manifest is not valid JSON at ${path}`);
  }
  if (!manifest || !Array.isArray(manifest.resources))
    throw new Error(`manifest has an unsupported shape at ${path}`);
  if (manifest.resources.filter(targetEntry).length !== 1)
    throw new Error(
      `manifest must contain exactly one target entry at ${path}`,
    );
  manifest.resources = manifest.resources.filter(
    (entry) => !targetEntry(entry),
  );
  report.removedManifestEntries += 1;
  report.changedPaths.push(`${path}.resources`);
  return wasString ? JSON.stringify(manifest) : manifest;
}

export function transformCheckpoint(
  checkpoint,
  { targetUrn = TARGET_URN } = {},
) {
  assertTargetUrn(targetUrn);
  const pending = getPendingOperations(checkpoint);
  if (!Array.isArray(pending) || pending.length !== 0)
    throw new Error(
      "checkpoint has pending operations; state transformation is unsafe",
    );
  validateTargetInCheckpoint(checkpoint, { targetUrn });
  const candidate = structuredClone(checkpoint);
  const resources = getResources(candidate);
  const report = {
    removedResources: 0,
    removedDependencyReferences: 0,
    removedIndexConfigReferences: 0,
    nulledIndexOutputs: 0,
    removedInventoryEntries: 0,
    removedManifestEntries: 0,
    changedPaths: [],
  };

  const root = exactlyOne(
    resources,
    (resource) => resource.urn === STACK_URN,
    "checkpoint lacks the exact preview stack output resource",
  );
  const provider = exactlyOne(
    resources,
    (resource) => resource.urn === PROVIDER_URN,
    "checkpoint lacks the exact Pulumi Node.js provider",
  );
  const runtime = exactlyOne(
    resources,
    (resource) => resource.urn === RUNTIME_URN,
    "checkpoint lacks the exact preview runtime release",
  );

  if (root.outputs?.vectorizeIndex !== TARGET_NAME)
    throw new Error(
      "preview stack vectorizeIndex output does not match the target",
    );
  root.outputs.vectorizeIndex = null;
  report.nulledIndexOutputs += 1;
  report.changedPaths.push(`${STACK_URN}.outputs.vectorizeIndex`);

  const inventory = root.outputs.environmentInventory?.resources;
  if (!Array.isArray(inventory) || inventory.filter(targetEntry).length !== 1)
    throw new Error(
      "preview environment inventory must contain exactly one target index",
    );
  root.outputs.environmentInventory.resources = inventory.filter(
    (entry) => !targetEntry(entry),
  );
  report.removedInventoryEntries += 1;
  report.changedPaths.push(
    `${STACK_URN}.outputs.environmentInventory.resources`,
  );

  for (const section of ["inputs", "outputs"]) {
    const values = provider[section];
    const indexKey = "savia-cloudflare:pagesSearchIndex";
    if (values?.[indexKey] !== TARGET_NAME)
      throw new Error(
        `provider pagesSearchIndex must match the target at ${section}`,
      );
    delete values[indexKey];
    report.removedIndexConfigReferences += 1;
    report.changedPaths.push(`${PROVIDER_URN}.${section}.${indexKey}`);
    const manifestKey = "savia-cloudflare:adoptionManifest";
    values[manifestKey] = removeManifestEntry(
      values[manifestKey],
      `${PROVIDER_URN}.${section}.${manifestKey}`,
      report,
    );
  }

  for (const section of ["inputs", "outputs"]) {
    runtime[section].adoptionManifest = removeManifestEntry(
      runtime[section]?.adoptionManifest,
      `${RUNTIME_URN}.${section}.adoptionManifest`,
      report,
    );
  }

  for (const resource of resources) {
    if (resource.urn === targetUrn) continue;
    if (Array.isArray(resource.dependencies)) {
      const remaining = resource.dependencies.filter(
        (dependency) => dependency !== targetUrn,
      );
      report.removedDependencyReferences +=
        resource.dependencies.length - remaining.length;
      if (remaining.length !== resource.dependencies.length) {
        resource.dependencies = remaining;
        report.changedPaths.push(`${resource.urn}.dependencies`);
      }
    }
    if (
      resource.propertyDependencies &&
      typeof resource.propertyDependencies === "object"
    ) {
      let changed = false;
      for (const [key, dependencies] of Object.entries(
        resource.propertyDependencies,
      )) {
        if (!Array.isArray(dependencies)) continue;
        const remaining = dependencies.filter(
          (dependency) => dependency !== targetUrn,
        );
        report.removedDependencyReferences +=
          dependencies.length - remaining.length;
        if (remaining.length !== dependencies.length) {
          changed = true;
          if (remaining.length) resource.propertyDependencies[key] = remaining;
          else delete resource.propertyDependencies[key];
        }
      }
      if (changed) {
        if (Object.keys(resource.propertyDependencies).length === 0)
          delete resource.propertyDependencies;
        report.changedPaths.push(`${resource.urn}.propertyDependencies`);
      }
    }
  }

  setResources(
    candidate,
    resources.filter((resource) => resource.urn !== targetUrn),
  );
  report.removedResources = resources.length - getResources(candidate).length;
  report.changedPaths.unshift(targetUrn);

  const dangling = findTargetReferences(candidate, targetUrn);
  if (dangling.length)
    throw new Error(
      `unrecognized reference to retired index remains at: ${dangling.join(", ")}`,
    );
  return { checkpoint: candidate, report };
}

export function validateTransformedCheckpoint(
  beforeCheckpoint,
  candidate,
  options = {},
) {
  const expected = transformCheckpoint(beforeCheckpoint, options).checkpoint;
  if (!sameJson(expected, candidate))
    throw new Error(
      "candidate differs from the allowlisted checkpoint transformation",
    );
  return true;
}

export function validateImportedCheckpoint(
  candidate,
  imported,
  { targetUrn = TARGET_URN } = {},
) {
  assertTargetUrn(targetUrn);
  if (findTargetReferences(imported, targetUrn).length)
    throw new Error(
      "imported checkpoint still contains a retired index reference",
    );
  const providerState = (state) =>
    state?.deployment?.secrets_providers ??
    state?.checkpoint?.latest?.secrets_providers ??
    state?.secrets_providers;
  if (!sameJson(providerState(candidate), providerState(imported)))
    throw new Error("imported checkpoint changed the secrets provider state");
  const deploymentManifest = (state) =>
    state?.deployment?.manifest ?? state?.checkpoint?.latest?.manifest;
  if (!sameJson(deploymentManifest(candidate), deploymentManifest(imported)))
    throw new Error("imported checkpoint changed deployment metadata");
  const expectedResources = getResources(candidate).toSorted((a, b) =>
    a.urn.localeCompare(b.urn),
  );
  const importedResources = getResources(imported).toSorted((a, b) =>
    a.urn.localeCompare(b.urn),
  );
  if (!sameJson(expectedResources, importedResources))
    throw new Error("imported checkpoint differs from candidate");
  const withoutResources = (state) => {
    const copy = structuredClone(state);
    if (Array.isArray(copy?.deployment?.resources))
      delete copy.deployment.resources;
    else if (Array.isArray(copy?.checkpoint?.latest?.resources))
      delete copy.checkpoint.latest.resources;
    else if (Array.isArray(copy?.resources)) delete copy.resources;
    return copy;
  };
  if (!sameJson(withoutResources(candidate), withoutResources(imported)))
    throw new Error(
      "imported checkpoint changed non-resource metadata or configuration",
    );
  return true;
}

function printReport(report) {
  process.stdout.write(
    `Candidate validated: removed ${report.removedResources} resource, ${report.removedDependencyReferences} dependency references, ${report.removedInventoryEntries} inventory entry, and ${report.removedManifestEntries} manifest entries; removed ${report.removedIndexConfigReferences} index config references and nulled ${report.nulledIndexOutputs} stack outputs.\n`,
  );
  for (const path of report.changedPaths) process.stdout.write(`  ${path}\n`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith("--") || value === undefined || values[key])
      throw new Error("invalid command arguments");
    values[key] = value;
  }
  return { command, values };
}

function safeError(operation, logPath) {
  const output = readFileSync(logPath, "utf8");
  let reason = "the command failed; detailed backend output is withheld";
  if (
    /access.?denied|unauthori[sz]ed|invalid credentials|invalid api token|forbidden/iu.test(
      output,
    )
  )
    reason = "backend credentials or permissions were rejected";
  else if (/stack.{0,30}(not found|does not exist)|no stack|404/iu.test(output))
    reason = "the requested stack or state object was not found";
  else if (/lock(ed)?|already in progress/iu.test(output))
    reason = "the stack is locked by another operation";
  else if (/protect|protected resource/iu.test(output))
    reason = "Pulumi protection prevented the state operation";
  else if (/parse|invalid checkpoint|malformed/iu.test(output))
    reason = "Pulumi rejected the checkpoint format";
  process.stderr.write(
    `${operation} failed: ${reason}. Detailed CLI output remains private.\n`,
  );
}

function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  const targetUrn = values["--target"];
  if (command === "transform") {
    const before = readJson(values["--checkpoint"]);
    const { checkpoint, report } = transformCheckpoint(before, { targetUrn });
    validateTransformedCheckpoint(before, checkpoint, { targetUrn });
    writeFileSync(values["--output"], `${JSON.stringify(checkpoint)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    printReport(report);
  } else if (command === "compare-import") {
    validateImportedCheckpoint(
      readJson(values["--candidate"]),
      readJson(values["--imported"]),
      { targetUrn },
    );
    process.stdout.write("Imported state matches the validated candidate.\n");
  } else if (command === "safe-error") {
    safeError(values["--operation"], values["--log"]);
    process.exitCode = 1;
  } else {
    throw new Error("unknown state reconciliation command");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
