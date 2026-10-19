import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { resolve, relative, join, isAbsolute, dirname, sep } from "node:path";

function outside(root, path) {
  const difference = relative(root, path);
  return (
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  );
}
export function assertCredentialFreeConfig(config) {
  const credential =
    /(?:^|_)(?:SECRET|PASSWORD|API_KEY|ENCRYPTION_KEY|SIGNING_KEY|ACCESS_TOKEN|API_TOKEN|CREDENTIALS)$/i;
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (credential.test(key))
        throw new Error("Immutable artifact cannot contain credential values");
      inspect(item);
    }
  }
  inspect(config.vars);
  if (
    config.env ||
    config.api_token ||
    config.api_key ||
    (config.secrets &&
      Object.keys(config.secrets).some((key) => key !== "required"))
  )
    throw new Error(
      "Immutable artifact cannot contain credential or environment overrides",
    );
}
function validateFrozenConfig(root, name, config) {
  assertCredentialFreeConfig(config);
  if (config.build?.command || config.build?.cwd)
    throw new Error("Immutable artifacts cannot run a custom build");
  const paths = [
    config.main,
    config.assets?.directory,
    config.migrations_dir,
    ...(config.d1_databases ?? []).map((binding) => binding.migrations_dir),
    ...Object.values(config.wasm_modules ?? {}),
    ...Object.values(config.text_blobs ?? {}),
    ...Object.values(config.data_blobs ?? {}),
  ].filter((value) => value !== undefined);
  for (const path of paths) {
    if (
      typeof path !== "string" ||
      isAbsolute(path) ||
      path.includes("\\") ||
      outside(root, resolve(root, dirname(name), path))
    )
      throw new Error("Config references a path outside the frozen artifact");
  }
}

async function fileInventory(root, current = root) {
  const entries = [];
  for (const item of (await readdir(current, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(current, item.name);
    if (
      /^(\.env(?:\..*)?|\.dev\.vars(?:\..*)?|secrets|.*\.private(?:\..*)?)$/.test(
        item.name,
      )
    )
      throw new Error(
        "Private credential files cannot enter a release artifact",
      );
    if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory()))
      throw new Error(
        "Artifacts may contain only regular files and directories",
      );
    if (item.isDirectory()) entries.push(...(await fileInventory(root, path)));
    else
      entries.push([
        relative(root, path),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]);
  }
  return entries;
}
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const artifactFiles = (files) =>
  files.filter(([name]) => name !== "release-manifest.json");
export async function prepareRuntimeArtifact({
  environment,
  release,
  destination,
}) {
  const source = await realpath(release.directory);
  const target = resolve(destination);
  if (target === source || !outside(source, target))
    throw new Error("Artifact destination must be outside source");
  const configs = Object.entries(release.configs ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [name, config] of configs) {
    if (
      isAbsolute(name) ||
      name.includes("..") ||
      name.includes("\\") ||
      !/^[a-zA-Z0-9/_-]+\.json$/.test(name)
    )
      throw new Error("Invalid config path");
    validateFrozenConfig(target, name, config);
  }
  await fileInventory(source);
  await mkdir(target, { mode: 0o700 });
  for (const name of await readdir(source)) {
    await cp(join(source, name), join(target, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  for (const [name, config] of configs) {
    const path = join(target, name);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  const result = {
    environment,
    artifactDirectory: target,
    artifactDigest: hash(artifactFiles(await fileInventory(target))),
    configDigest: hash(configs),
  };
  await writeFile(
    join(target, "release-manifest.json"),
    JSON.stringify({ ...result, configs: configs.map(([name]) => name) }),
    { flag: "wx", mode: 0o600 },
  );
  return result;
}
export async function verifyRuntimeArtifact(inputs) {
  const root = inputs.artifactDirectory;
  const manifest = JSON.parse(
    await readFile(join(root, "release-manifest.json"), "utf8"),
  );
  const configs = [];
  for (const name of manifest.configs) {
    if (
      typeof name !== "string" ||
      name.includes("..") ||
      isAbsolute(name) ||
      name.includes("\\")
    )
      throw new Error("Invalid config path");
    const config = JSON.parse(await readFile(join(root, name), "utf8"));
    validateFrozenConfig(root, name, config);
    configs.push([name, config]);
  }
  if (
    manifest.environment !== inputs.environment ||
    hash(artifactFiles(await fileInventory(root))) !== inputs.artifactDigest ||
    hash(configs) !== inputs.configDigest
  )
    throw new Error("Immutable artifact digest mismatch");
  const declaredNamespaces = [];
  for (const [, config] of configs) {
    for (const migration of config.migrations ?? []) {
      if (
        migration.deleted_classes?.length ||
        migration.transferred_classes?.length
      )
        throw new Error(
          "Destructive namespace migrations or transfers require a separate reviewed data operation",
        );
    }
    for (const binding of config.durable_objects?.bindings ?? []) {
      if (!binding.script_name || binding.script_name === config.name)
        declaredNamespaces.push({
          workerName: config.name,
          className: binding.class_name,
        });
    }
  }
  return { ...manifest, declaredNamespaces };
}
export async function publishRuntime(inputs, operations) {
  for (const name of [
    "quiesce",
    "backup",
    "migrate",
    "secrets",
    "deploy",
    "verify",
    "resume",
  ]) {
    if (typeof operations[name] !== "function")
      throw new Error(`Missing release operation: ${name}`);
    await operations[name](inputs);
  }
}
