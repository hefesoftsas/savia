import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { watch } from "node:fs";
import { readFile, writeFile, mkdir, rm, realpath } from "node:fs/promises";
import { resolve, dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { packageStorePlugin } from "./pack-store-plugin.mjs";

const root = resolve(import.meta.dirname, "..");

export function localOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Plugin development only supports a local HTTP origin.");
  return url.origin;
}

/** A change while building schedules one follow-up build; builds never overlap. */
export function createBuildQueue(build, onError = console.error) {
  let active = false,
    pending = false,
    stopped = false;
  async function run() {
    if (stopped) return;
    pending = true;
    if (active) return;
    active = true;
    try {
      while (pending && !stopped) {
        pending = false;
        try {
          await build();
        } catch (error) {
          onError(error);
        }
      }
    } finally {
      active = false;
    }
  }
  return {
    run,
    stop() {
      stopped = true;
      pending = false;
    },
  };
}

export async function runPluginDev(args) {
  const [directory, ...options] = args;
  const accepted = new Set([
    "--tenant",
    "--origin",
    "--admin-origin",
    "--once",
  ]);
  const values = {};
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    if (!accepted.has(option)) throw new Error(`Unknown option: ${option}`);
    if (option === "--once") values.once = true;
    else {
      const value = options[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value: ${option}`);
      values[option.slice(2)] = value;
    }
  }
  if (
    !directory ||
    !/^(0|[1-9]\d*)$/.test(values.tenant ?? "") ||
    !Number.isSafeInteger(Number(values.tenant))
  )
    throw new Error(
      "Usage: pnpm plugin:dev <directory> --tenant <local tenant ID> [--once] [--origin http://127.0.0.1:8787] [--admin-origin http://127.0.0.1:5173]",
    );
  const origin = localOrigin(values.origin ?? "http://127.0.0.1:8787");
  const runtime = join(root, "apps/api/.wrangler/local-runtime");
  const key = await readFile(
    join(runtime, "plugin-development-key"),
    "utf8",
  ).catch(() => {
    throw new Error("Start pnpm dev first to prepare the local plugin host.");
  });
  const health = await fetch(`${origin}/__dev/plugins/health`, {
    headers: { authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!health.ok || !(await health.json()).development)
    throw new Error(
      "Local plugin host unavailable. Restart pnpm dev with the current checkout.",
    );
  const localVars = parseEnv(
    await readFile(join(runtime, "core/.dev.vars"), "utf8"),
  );
  const adminOrigin = localOrigin(
    values["admin-origin"] ??
      localVars.SAVIA_PUBLIC_ORIGIN ??
      "http://127.0.0.1:5173",
  );
  const portDir = await realpath(resolve(root, directory));
  const relativeDirectory = relative(await realpath(root), portDir);
  if (relativeDirectory.startsWith("..") || isAbsolute(relativeDirectory))
    throw new Error("Plugin directory must be inside this workspace.");
  const manifestPath = join(portDir, "savia-extension.json"),
    storePath = join(portDir, "store.json");
  let stopped = false;
  let watchers = [],
    timer,
    revision = Date.now(),
    lastInputs = [];
  const outputDirectory = join(
    runtime,
    "plugin-builds",
    createHash("sha256").update(portDir).digest("hex").slice(0, 16),
    String(process.pid),
  );
  await mkdir(outputDirectory, { recursive: true });
  function watchInputs(inputs) {
    if (stopped) return;
    const directories = new Set([
      portDir,
      ...inputs.filter((p) => !p.includes("/node_modules/")).map(dirname),
    ]);
    const targets = new Set([manifestPath, storePath, ...inputs]);
    const next = [];
    for (const dir of directories) {
      try {
        next.push(
          watch(dir, { recursive: dir === portDir }, (_event, file) => {
            const name = String(file ?? "");
            if (/(^|[/\\])(node_modules|dist|\.git)([/\\]|$)/.test(name))
              return;
            if (
              !file ||
              targets.has(join(dir, name)) ||
              /\.(tsx?|jsx?|json|css|svg|png|webp)$/.test(name) ||
              !name.includes(".")
            ) {
              clearTimeout(timer);
              timer = setTimeout(() => void queue.run(), 200);
            }
          }),
        );
      } catch {
        /* Missing imports are reported by the builder. */
      }
    }
    for (const watcher of watchers) watcher.close();
    watchers = next;
  }
  async function build() {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    // New immutable local artifact for each build. Never edit the release manifest.
    const version = `${manifest.version.split(".").slice(0, 2).join(".")}.${++revision}`;
    const result = packageStorePlugin({
      portDir,
      outputPath: join(outputDirectory, "current.zip"),
      versionOverride: version,
    });
    lastInputs = result.inputs;
    if (!values.once) watchInputs(lastInputs);
    const body = new FormData();
    body.set(
      "file",
      new Blob([await readFile(resolve(root, result.artifactPath))]),
      "plugin.store.zip",
    );
    const response = await fetch(
      `${origin}/__dev/plugins/install?tenant=${values.tenant}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        `Local installation failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    const store = JSON.parse(await readFile(storePath, "utf8"));
    const object = store.screens?.[0]?.object;
    const url = `${adminOrigin}/#/studio?tenantId=${values.tenant}${object ? `&object=${encodeURIComponent(object)}` : "&view=admin"}`;
    await writeFile(
      join(runtime, "plugin-reload.json"),
      JSON.stringify({
        id: manifest.id,
        version,
        tenant: Number(values.tenant),
        at: Date.now(),
      }),
    );
    console.log(
      `Installed ${manifest.id}@${version} in local tenant ${values.tenant}\n${url}`,
    );
    await rm(resolve(root, result.artifactPath), { force: true });
  }
  let failure = false;
  const queue = createBuildQueue(build, (error) => {
    failure = true;
    console.error(error.message ?? String(error));
  });
  if (!values.once) watchInputs([]);
  await queue.run();
  if (values.once) {
    if (failure) process.exitCode = 1;
    return;
  }
  console.log(
    "Watching plugin and workspace dependencies. Successful builds refresh the plugin in local Savia; unsaved plugin forms will reset. Ctrl+C to stop.",
  );
  const stop = () => {
    stopped = true;
    queue.stop();
    clearTimeout(timer);
    watchers.forEach((w) => w.close());
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  runPluginDev(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
