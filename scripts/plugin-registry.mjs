import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 6 * 1024 * 1024;
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function registryConnection(env = process.env) {
  try {
    const url = new URL(env.SAVIA_PLUGIN_REGISTRY_URL);
    const token = env.SAVIA_PLUGIN_REGISTRY_TOKEN;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      typeof token !== "string" ||
      token.length < 32 ||
      /\s/.test(token)
    )
      throw new Error();
    return { url: url.origin, token };
  } catch {
    throw new Error(
      "Set SAVIA_PLUGIN_REGISTRY_URL to a secure origin and SAVIA_PLUGIN_REGISTRY_TOKEN to a valid credential.",
    );
  }
}

function identity(plugin) {
  if (
    !plugin ||
    typeof plugin.id !== "string" ||
    !idPattern.test(plugin.id) ||
    plugin.id.length > 100 ||
    typeof plugin.version !== "string" ||
    !versionPattern.test(plugin.version) ||
    plugin.version.length > 30
  )
    throw new Error("Invalid plugin identity.");
  return `${encodeURIComponent(plugin.id)}/${encodeURIComponent(plugin.version)}`;
}

export function validateLock(lock) {
  if (lock?.schemaVersion !== 1 || !Array.isArray(lock.plugins))
    throw new Error("Invalid plugin registry lockfile.");
  const ids = new Set();
  for (const plugin of lock.plugins) {
    identity(plugin);
    if (
      !/^[a-f0-9]{64}$/.test(plugin.sha256) ||
      !Number.isInteger(plugin.sizeBytes) ||
      plugin.sizeBytes < 1 ||
      plugin.sizeBytes > MAX_BYTES
    )
      throw new Error("Invalid plugin digest or size.");
    if (ids.has(plugin.id)) throw new Error("Duplicate plugin ID in lockfile.");
    ids.add(plugin.id);
  }
  return lock;
}

async function request(config, path, init, transport) {
  let response;
  try {
    response = await transport(`${config.url}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${config.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(
      "Registry connection failed. Check connectivity and credentials.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Registry request failed (HTTP ${response.status}).`);
  }
  return response;
}
async function boundedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty registry response.");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit)
        throw new Error("Registry response exceeds size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks, length);
}
export async function publishRelease(config, plugin, bytes, transport = fetch) {
  const path = identity(plugin);
  if (bytes.length < 1 || bytes.length > MAX_BYTES)
    throw new Error("Plugin ZIP exceeds size limit.");
  const response = await request(
    config,
    `/v1/plugins/${path}`,
    {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: bytes,
    },
    transport,
  );
  const payload = JSON.parse(
    (await boundedBytes(response, 64 * 1024)).toString("utf8"),
  );
  const release = validateLock({ schemaVersion: 1, plugins: [payload.data] })
    .plugins[0];
  if (release.id !== plugin.id || release.version !== plugin.version)
    throw new Error("Registry returned a different plugin identity.");
  if (!payload.deduped && release.sha256 !== sha256(bytes))
    throw new Error("Published plugin digest mismatch.");
  return release;
}
export async function downloadRelease(config, plugin, transport = fetch) {
  validateLock({ schemaVersion: 1, plugins: [plugin] });
  const response = await request(
    config,
    `/v1/plugins/${identity(plugin)}`,
    { method: "GET" },
    transport,
  );
  const bytes = await boundedBytes(response, MAX_BYTES);
  if (sha256(bytes) !== plugin.sha256 || bytes.length !== plugin.sizeBytes)
    throw new Error("Downloaded plugin digest mismatch.");
  return bytes;
}

async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === "--help") {
    console.log(
      "Usage: pnpm registry publish <id> <version> <zip> <lockfile>\n       pnpm registry pull <lockfile> <directory>\nCredentials: SAVIA_PLUGIN_REGISTRY_URL and SAVIA_PLUGIN_REGISTRY_TOKEN (environment only).",
    );
    return;
  }
  const config = registryConnection();
  if (command === "publish" && rest.length === 4) {
    const [id, version, file, lockPath] = rest;
    let lock;
    try {
      lock = validateLock(JSON.parse(await readFile(lockPath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      lock = { schemaVersion: 1, plugins: [] };
    }
    const release = await publishRelease(
      config,
      { id, version },
      await readFile(file),
    );
    lock.plugins = [...lock.plugins.filter((p) => p.id !== id), release].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
    // Persist lock atomically. It contains no credentials and can be committed.
    const temporary = `${lockPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(lock, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(temporary, lockPath);
    console.log(
      `Published ${id}@${version}; locked SHA-256 ${release.sha256}.`,
    );
  } else if (command === "pull" && rest.length === 2) {
    const [file, directory] = rest;
    const lock = validateLock(JSON.parse(await readFile(file, "utf8")));
    // Verify every artifact before writing any final package.
    const downloads = [];
    for (const plugin of lock.plugins)
      downloads.push({ plugin, bytes: await downloadRelease(config, plugin) });
    await mkdir(directory, { recursive: true });
    for (const { plugin, bytes } of downloads) {
      const target = join(directory, `${plugin.id}-${plugin.version}.zip`);
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      console.log(`Downloaded ${plugin.id}@${plugin.version}.`);
    }
  } else throw new Error("Invalid arguments. Run pnpm registry --help.");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
