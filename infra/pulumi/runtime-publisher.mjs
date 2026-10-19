import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { resolve, relative, join, isAbsolute } from "node:path";

async function fileInventory(root, current = root) {
  const entries = [];
  for (const item of (await readdir(current, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(current, item.name);
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
  if (target === source || !relative(source, target).startsWith(".."))
    throw new Error("Artifact destination must be outside source");
  const configs = Object.entries(release.configs ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [name] of configs)
    if (
      isAbsolute(name) ||
      name.includes("..") ||
      name.includes("\\") ||
      !/^[a-zA-Z0-9/_-]+\.json$/.test(name)
    )
      throw new Error("Invalid config path");
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
    configs.push([name, JSON.parse(await readFile(join(root, name), "utf8"))]);
  }
  if (
    manifest.environment !== inputs.environment ||
    hash(artifactFiles(await fileInventory(root))) !== inputs.artifactDigest ||
    hash(configs) !== inputs.configDigest
  )
    throw new Error("Immutable artifact digest mismatch");
  return manifest;
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
