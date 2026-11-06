import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  cp,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  dirname,
  resolve,
  relative,
  isAbsolute,
  basename,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareRuntimeArtifact,
  assertCredentialFreeConfig,
} from "./runtime-publisher.mjs";
import { execFileWithInput } from "./runtime-publisher-branch.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
async function normalizeBuildMetadata(directory) {
  // Wrangler's README embeds a timestamp and source maps use the temporary
  // outdir as sourceRoot. Neither should change a content-addressed release.
  await rm(join(directory, "README.md"), { force: true });
  for (const file of await readdir(directory))
    if (/\.m?js\.map$/.test(file)) {
      const path = join(directory, file),
        map = JSON.parse(await readFile(path, "utf8"));
      const sourceRoot = resolve(directory, map.sourceRoot ?? "");
      map.sources = (map.sources ?? []).map((source, index) => {
        if (/^[a-z]+:/.test(source)) return source;
        const absolute = resolve(sourceRoot, source),
          name = relative(root, absolute)
            .replaceAll("\\", "/")
            .replace(
              /\.wrangler\/tmp\/bundle-[^/]+\//g,
              ".wrangler/generated/",
            );
        if (!name.startsWith("..") && !isAbsolute(name)) return name;
        const digest = createHash("sha256")
          .update(map.sourcesContent?.[index] ?? basename(source))
          .digest("hex")
          .slice(0, 12);
        return `external/${digest}/${basename(source)}`;
      });
      map.sourceRoot = "";
      if (map.file) map.file = basename(map.file);
      await writeFile(path, JSON.stringify(map), { mode: 0o600 });
    }
}

export async function freezeRuntimeRelease(
  {
    environment,
    configs,
    destination,
    domainMigrations,
    sourceRevision,
    codeOnly,
  },
  {
    runWrangler = async (args) => {
      try {
        return await execFileWithInput(
          join(root, "apps/api/node_modules/.bin/wrangler"),
          args,
          {
            cwd: root,
            env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
          },
        );
      } catch {
        throw new Error("Frozen Worker build failed");
      }
    },
  } = {},
) {
  if (!Array.isArray(configs) || !configs.length)
    throw new Error("Prepared source configurations are required");
  const sources = [],
    names = new Set();
  for (const path of configs) {
    const config = JSON.parse(await readFile(path, "utf8"));
    if (
      !/^savia(?:-[a-z0-9]+)*$/.test(config.name) ||
      names.has(config.name) ||
      !config.main ||
      config.build?.command ||
      config.build?.cwd
    )
      throw new Error("Invalid or duplicate source Worker build target");
    assertCredentialFreeConfig(config);
    names.add(config.name);
    sources.push({ path: resolve(path), config });
  }
  const work = await mkdtemp(join(tmpdir(), "savia-frozen-build-"));
  const staging = join(work, "payload");
  await mkdir(staging);
  try {
    if (sourceRevision !== undefined) {
      if (!/^[a-f\d]{40}$/.test(sourceRevision))
        throw new Error("Exact source revision required");
      await writeFile(
        join(staging, "release-source.json"),
        JSON.stringify({
          version: 1,
          sourceRevision,
          ...(codeOnly ? { codeOnly } : {}),
        }),
        { mode: 0o600 },
      );
    }
    const frozen = {};
    if (domainMigrations)
      await cp(domainMigrations, join(staging, "migrations"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    for (const { path, config } of sources) {
      const directory = join(staging, "workers", config.name);
      await mkdir(directory, { recursive: true });
      const metafile = join(work, `${config.name}.build-meta.json`);
      await runWrangler([
        "deploy",
        "--dry-run",
        "--config",
        path,
        "--outdir",
        directory,
        "--metafile",
        metafile,
      ]);
      const metadata = JSON.parse(await readFile(metafile, "utf8"));
      const entries = Object.entries(metadata.outputs ?? {}).filter(
        ([file, info]) => info.entryPoint && /\.m?js$/.test(file),
      );
      if (entries.length !== 1)
        throw new Error("Worker compiler must produce one entry module");
      const requiredExports = [
        ...(config.durable_objects?.bindings ?? [])
          .filter(
            (binding) =>
              !binding.script_name || binding.script_name === config.name,
          )
          .map((binding) => binding.class_name),
        ...(config.workflows ?? [])
          .filter(
            (binding) =>
              !binding.script_name || binding.script_name === config.name,
          )
          .map((binding) => binding.class_name),
      ];
      if (
        requiredExports.some((name) => !entries[0][1].exports?.includes(name))
      )
        throw new Error(
          "Worker bundle is missing a declared Durable Object or Workflow export",
        );
      const entry = resolve(dirname(path), entries[0][0]);
      const main = relative(directory, entry);
      if (
        main.startsWith("..") ||
        isAbsolute(main) ||
        !(await stat(entry)).isFile()
      )
        throw new Error(
          "Worker compiler entry is outside its frozen directory",
        );
      await normalizeBuildMetadata(directory);
      const output = structuredClone(config);
      if (
        ["preview", "production"].includes(environment) &&
        config.name ===
          (environment === "preview" ? "savia-auth-preview" : "savia-auth")
      ) {
        if (!sourceRevision)
          throw new Error("Managed Auth requires an exact source revision");
        output.vars = {
          ...output.vars,
          SAVIA_AUTH_DEPLOYMENT_REVISION: sourceRevision,
        };
      }
      delete output.$schema;
      delete output.build;
      output.main = main;
      output.no_bundle = true;
      output.find_additional_modules = true;
      if (config.assets?.directory) {
        await cp(
          resolve(dirname(path), config.assets.directory),
          join(directory, "assets"),
          { recursive: true, errorOnExist: true, force: false },
        );
        output.assets.directory = "assets";
      }
      for (const [index, binding] of (output.d1_databases ?? []).entries())
        if (binding.migrations_dir) {
          const migrationDir = `migrations-${index}`;
          await cp(
            resolve(dirname(path), binding.migrations_dir),
            join(directory, migrationDir),
            { recursive: true, errorOnExist: true, force: false },
          );
          binding.migrations_dir = migrationDir;
        }
      if (output.migrations_dir) {
        await cp(
          resolve(dirname(path), output.migrations_dir),
          join(directory, "migrations"),
          { recursive: true, errorOnExist: true, force: false },
        );
        output.migrations_dir = "migrations";
      }
      for (const key of ["wasm_modules", "text_blobs", "data_blobs"])
        for (const [binding, source] of Object.entries(output[key] ?? {})) {
          if (!/^[A-Za-z0-9_]+$/.test(binding))
            throw new Error("Invalid frozen module binding");
          await mkdir(join(directory, "bindings"), { recursive: true });
          const target = `bindings/${binding}`;
          await cp(resolve(dirname(path), source), join(directory, target), {
            force: false,
            errorOnExist: true,
          });
          output[key][binding] = target;
        }
      frozen[`workers/${config.name}/wrangler.json`] = output;
    }
    return await prepareRuntimeArtifact({
      environment,
      release: { directory: staging, configs: frozen },
      destination,
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
