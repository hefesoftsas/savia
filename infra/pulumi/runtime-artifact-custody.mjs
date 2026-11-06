import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { encryptBackup } from "../../scripts/encrypt-flows-backup.mjs";
import { verifyRuntimeArtifact } from "./runtime-publisher.mjs";
import { renderCloudflareConfigFromEnv } from "./worker-config.mjs";
import { createRuntimeCloudClient } from "./runtime-cloud.mjs";

const run = promisify(execFile);
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceConfigPaths = [
  "apps/api/wrangler.preview.jsonc",
  "apps/auth/wrangler.preview.jsonc",
  "apps/admin/wrangler.preview.jsonc",
  "apps/mcp/wrangler.preview.jsonc",
  "apps/savia-request/wrangler.preview.jsonc",
  "apps/connector-gateway/wrangler.preview.jsonc",
  "apps/hook-executor/wrangler.preview.jsonc",
  "apps/backup-coordinator/wrangler.preview.jsonc",
  "apps/flows/api/wrangler.preview.jsonc",
  "apps/plugin-editor-runtime/wrangler.preview.jsonc",
];
const safeIdentity = ({ runId, sourceSha, environment, accountId }) => {
  if (
    !/^\d+$/.test(String(runId ?? "")) ||
    !shaPattern.test(sourceSha ?? "") ||
    environment !== "preview" ||
    !/^[a-f0-9]{32}$/.test(accountId ?? "")
  )
    throw new Error("Invalid Preview release artifact identity");
};

async function inventory(root, current = root) {
  if (current === root) {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Preview release artifact root must be a real directory");
  }
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new Error("Preview release artifact contains a non-regular path");
    const name = relative(root, path).replaceAll("\\", "/");
    if (
      !name ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      /[\u0000-\u001f\u007f]/.test(name)
    )
      throw new Error("Preview release artifact contains an unsafe path");
    if (info.isDirectory()) result.push(...(await inventory(root, path)));
    else result.push(name);
  }
  return result.sort();
}

async function artifactIdentity(directory, identity) {
  const raw = JSON.parse(
    await readFile(join(directory, "release-manifest.json"), "utf8"),
  );
  const artifact = {
    ...raw,
    artifactDirectory: directory,
    environment: identity.environment,
  };
  const verified = await verifyRuntimeArtifact(artifact);
  const source = JSON.parse(
    await readFile(join(directory, "release-source.json"), "utf8"),
  );
  if (source.sourceRevision !== identity.sourceSha)
    throw new Error("Preview release source SHA does not match its run");
  if (
    !digestPattern.test(raw.artifactDigest ?? "") ||
    !digestPattern.test(raw.configDigest ?? "")
  )
    throw new Error("Preview release artifact digests are invalid");
  const workerNames = [];
  for (const configPath of raw.configs ?? []) {
    const config = JSON.parse(
      await readFile(join(directory, configPath), "utf8"),
    );
    if (
      typeof config.name !== "string" ||
      !/^savia(?:-[a-z0-9]+)*$/.test(config.name)
    )
      throw new Error("Preview release has an invalid Worker identity");
    workerNames.push(config.name);
  }
  if (!workerNames.length || new Set(workerNames).size !== workerNames.length)
    throw new Error(
      "Preview release Worker identities are incomplete or duplicated",
    );
  return {
    metadata: {
      version: 1,
      runId: String(identity.runId),
      sourceSha: identity.sourceSha,
      environment: identity.environment,
      accountId: identity.accountId,
      artifactDigest: raw.artifactDigest,
      configDigest: raw.configDigest,
      workerNames: workerNames.sort(),
    },
    artifact: verified,
  };
}

async function currentSourceConfigDigest(
  workerNames,
  env = process.env,
  readSubdomain = async () => {
    const client = createRuntimeCloudClient(
      { accountId: env.CLOUDFLARE_ACCOUNT_ID, workers: [] },
      { env },
    );
    return (await client.api("/workers/subdomain")).subdomain;
  },
  { includePluginEditor = true } = {},
) {
  const temporary = await mkdtemp(
    join(tmpdir(), "savia-preview-config-check-"),
  );
  try {
    await renderCloudflareConfigFromEnv({
      ...env,
      SAVIA_DEPLOY_CONFIG_ROOT: temporary,
    });
    const expected = new Set(workerNames);
    const configs = new Map();
    for (const path of sourceConfigPaths) {
      let config;
      try {
        config = JSON.parse(await readFile(join(temporary, path), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (expected.has(config.name)) {
        if (configs.has(config.name))
          throw new Error(
            "Preview config renderer produced duplicate Worker identities",
          );
        configs.set(config.name, config);
      }
    }
    if (configs.size !== expected.size)
      throw new Error(
        "Current Preview configuration does not match release Workers",
      );
    let pluginEditorDeploymentUrl;
    if (includePluginEditor) {
      pluginEditorDeploymentUrl = env.SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL;
      if (!pluginEditorDeploymentUrl) {
        const subdomain = await readSubdomain();
        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain ?? ""))
          throw new Error("Current Preview Workers subdomain is unavailable");
        pluginEditorDeploymentUrl = `https://savia-plugin-editor-preview.${subdomain}.workers.dev`;
      }
      if (
        !/^https:\/\/savia-plugin-editor-preview\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/.test(
          pluginEditorDeploymentUrl,
        )
      )
        throw new Error("Invalid Preview plugin editor deployment URL");
    }
    const configFingerprint = {
      configs: [...configs.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, config]) => [`workers/${name}/wrangler.json`, config]),
    };
    if (includePluginEditor) {
      configFingerprint.pluginEditorDeploymentUrl = pluginEditorDeploymentUrl;
      configFingerprint.pluginEditorRuntimeUrl = `${pluginEditorDeploymentUrl}/plugin-editor`;
    }
    return {
      digest: hash(configFingerprint),
      pluginEditorDeploymentUrl,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function validatePreviewArchiveListing(listing, verbose) {
  if (!listing.trim() || !verbose.trim())
    throw new Error("Preview release archive inventory is ambiguous");
  const names = listing.trimEnd().split("\n");
  const types = verbose.trimEnd().split("\n");
  if (!names.length || names.length !== types.length)
    throw new Error("Preview release archive inventory is ambiguous");
  const seen = new Set();
  for (let index = 0; index < names.length; index++) {
    let name = names[index];
    if (name === "./") continue;
    if (!name.startsWith("./"))
      throw new Error("Preview release archive path is unsafe");
    name = name.slice(2).replace(/\/$/, "");
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(name) ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      (types[index][0] !== "-" && types[index][0] !== "d")
    )
      throw new Error(
        "Preview release archive contains an unsafe path or link",
      );
    if (seen.has(name))
      throw new Error("Preview release archive has duplicate paths");
    seen.add(name);
  }
  return [...seen];
}

async function archiveEntries(path) {
  let listing, verbose;
  try {
    ({ stdout: listing } = await run("tar", ["-tzf", path], {
      maxBuffer: 32 * 1024 * 1024,
    }));
    ({ stdout: verbose } = await run("tar", ["-tvzf", path], {
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch {
    throw new Error("Preview release archive is corrupt");
  }
  return validatePreviewArchiveListing(listing, verbose);
}

export async function retainPreviewRuntimeArtifact({
  artifactDirectory,
  archivePath,
  provenancePath,
  key,
  runId,
  sourceSha,
  environment,
  accountId,
  env = process.env,
}) {
  const identity = { runId, sourceSha, environment, accountId };
  safeIdentity(identity);
  const directory = resolve(artifactDirectory);
  const { metadata, artifact } = await artifactIdentity(directory, identity);
  metadata.sourceConfigDigest = (
    await currentSourceConfigDigest(metadata.workerNames, env, undefined, {
      includePluginEditor: !artifact.releaseSource?.codeOnly,
    })
  ).digest;
  await inventory(directory);
  const temporary = await mkdtemp(join(tmpdir(), "savia-preview-custody-"));
  try {
    const tarPath = join(temporary, "release.tar.gz");
    await run("tar", ["-czf", tarPath, "-C", directory, "."], {
      maxBuffer: 1024 * 1024,
    });
    const metadataPath = join(temporary, "provenance.json");
    await writeFile(metadataPath, JSON.stringify(metadata), {
      flag: "wx",
      mode: 0o600,
    });
    await encryptBackup(tarPath, resolve(archivePath), key);
    try {
      await encryptBackup(metadataPath, resolve(provenancePath), key);
    } catch (error) {
      await rm(resolve(archivePath), { force: true });
      throw error;
    }
    return metadata;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function restorePreviewRuntimeArtifact({
  archivePath,
  provenancePath,
  destination,
  key,
  runId,
  sourceSha,
  environment,
  accountId,
  env = process.env,
}) {
  const identity = { runId, sourceSha, environment, accountId };
  safeIdentity(identity);
  const output = resolve(destination);
  const parent = dirname(output);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(parent, ".preview-release-restore-"));
  try {
    const tarPath = join(staging, "release.tar.gz");
    const metadataPath = join(staging, "provenance.json");
    const payloadPath = join(staging, "payload");
    await mkdir(payloadPath, { mode: 0o700 });
    await encryptBackup(resolve(provenancePath), metadataPath, key, true);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (
      metadata.version !== 1 ||
      metadata.runId !== String(runId) ||
      metadata.sourceSha !== sourceSha ||
      metadata.environment !== environment ||
      metadata.accountId !== accountId ||
      !digestPattern.test(metadata.artifactDigest ?? "") ||
      !digestPattern.test(metadata.configDigest ?? "") ||
      !digestPattern.test(metadata.sourceConfigDigest ?? "") ||
      !Array.isArray(metadata.workerNames) ||
      metadata.workerNames.some((name) => typeof name !== "string")
    )
      throw new Error("Preview release provenance does not match this run");
    await encryptBackup(resolve(archivePath), tarPath, key, true);
    await archiveEntries(tarPath);
    await run(
      "tar",
      [
        "--no-same-owner",
        "--no-same-permissions",
        "-xzf",
        tarPath,
        "-C",
        payloadPath,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    await inventory(payloadPath);
    const { metadata: actual, artifact: actualArtifact } =
      await artifactIdentity(payloadPath, identity);
    if (
      actual.artifactDigest !== metadata.artifactDigest ||
      actual.configDigest !== metadata.configDigest ||
      JSON.stringify(actual.workerNames) !==
        JSON.stringify([...metadata.workerNames].sort())
    )
      throw new Error(
        "Preview release artifact digest or Worker identity mismatch",
      );
    const currentConfig = await currentSourceConfigDigest(
      actual.workerNames,
      env,
      undefined,
      { includePluginEditor: !actualArtifact.releaseSource?.codeOnly },
    );
    if (currentConfig.digest !== metadata.sourceConfigDigest)
      return { restored: false, reason: "current-preview-config-changed" };
    try {
      await lstat(output);
      throw new Error("Preview release restore destination already exists");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await chmod(payloadPath, 0o700);
    await rename(payloadPath, output);
    if (env.GITHUB_ENV && currentConfig.pluginEditorDeploymentUrl)
      await appendFile(
        env.GITHUB_ENV,
        `SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL=${currentConfig.pluginEditorDeploymentUrl}\n`,
      );
    return { ...actual, restored: true };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function parse(argv) {
  const action = argv[0];
  if (!["retain", "restore"].includes(action))
    throw new Error("Use retain or restore");
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith("--") || Object.hasOwn(values, key) || !argv[index + 1])
      throw new Error("Invalid Preview artifact custody arguments");
    values[key] = argv[index + 1];
  }
  const allowed =
    action === "retain"
      ? [
          "--run-id",
          "--sha",
          "--environment",
          "--account-id",
          "--artifact",
          "--archive",
          "--provenance",
        ]
      : [
          "--run-id",
          "--sha",
          "--environment",
          "--account-id",
          "--archive",
          "--provenance",
          "--destination",
        ];
  if (Object.keys(values).some((key) => !allowed.includes(key)))
    throw new Error("Invalid Preview artifact custody arguments");
  const take = (name) => {
    const value = values[`--${name}`];
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  const base = {
    key: process.env.SAVIA_BACKUP_KEY,
    runId: take("run-id"),
    sourceSha: take("sha"),
    environment: take("environment"),
    accountId: take("account-id"),
  };
  if (action === "retain")
    return {
      action,
      args: {
        ...base,
        artifactDirectory: take("artifact"),
        archivePath: take("archive"),
        provenancePath: take("provenance"),
      },
    };
  return {
    action,
    args: {
      ...base,
      archivePath: take("archive"),
      provenancePath: take("provenance"),
      destination: take("destination"),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { action, args } = parse(process.argv.slice(2));
    const result =
      action === "retain"
        ? await retainPreviewRuntimeArtifact(args)
        : await restorePreviewRuntimeArtifact(args);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    process.stderr.write("Preview runtime artifact custody failed\n");
    process.exitCode = 1;
  }
}
