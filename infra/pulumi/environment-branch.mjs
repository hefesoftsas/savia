import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  flagValue,
  previewNames,
  slugifyBranch,
  dryRunDatabaseUuid,
} from "../../scripts/preview-environment.mjs";
import {
  workerConfig,
  execFileWithInput,
} from "./runtime-publisher-branch.mjs";
import {
  createEnvironmentDependencies,
  inventoryManifest,
  writePrivateJson,
} from "./environment-operations.mjs";
import {
  parseEnvironmentArgs,
  runEnvironmentOperation,
} from "./environment.mjs";
import { createRuntimeCloudClient } from "./runtime-cloud.mjs";
import { freezeRuntimeRelease } from "./runtime-artifact.mjs";
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export async function runBranchDeployment(
  argv,
  {
    env = process.env,
    dependencies = () => createEnvironmentDependencies({ env }),
    run = execFileWithInput,
    freeze = freezeRuntimeRelease,
    sourceRoot = env.SAVIA_RELEASE_SOURCE_ROOT ?? root,
    subdomain,
  } = {},
) {
  const slug = slugifyBranch(flagValue(argv, "--branch")),
    environment = `branch-${slug}`,
    names = previewNames(slug),
    dry = argv.includes("--dry-run"),
    skipAdmin = argv.includes("--skip-admin");
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--branch") {
      index++;
      continue;
    }
    if (
      !["--dry-run", "--skip-admin", "--enable-schedules"].includes(argv[index])
    )
      throw new Error("Unknown branch deployment option");
  }
  const directory = await mkdtemp(join(tmpdir(), `savia-branch-${slug}-`));
  let inventory, deps;
  if (!dry) {
    deps = dependencies();
    inventory = await deps.inventory(environment);
    if (!inventory.resources.some((row) => row.kind === "worker")) {
      await runEnvironmentOperation(
        parseEnvironmentArgs([
          "plan",
          "--environment",
          environment,
          "--provision",
          "--apply",
        ]),
        deps,
      );
      inventory = await deps.inventory(environment);
    } else {
      const manifest = join(directory, "adoption.json");
      await writePrivateJson(manifest, inventoryManifest(inventory));
      await runEnvironmentOperation(
        parseEnvironmentArgs([
          "adopt",
          "--environment",
          environment,
          "--manifest",
          manifest,
          "--apply",
        ]),
        deps,
      );
    }
  }
  const actual =
    inventory?.resources
      .filter((row) => row.kind === "worker")
      .map((row) => row.name) ?? [];
  if (skipAdmin && actual.includes(names.workers.gateway))
    throw new Error(
      "An existing gateway needs a complete managed release; --skip-admin is for headless environments",
    );
  const kinds = Object.keys(names.workers).filter(
    (role) =>
      (!actual.length || actual.includes(names.workers[role])) &&
      (!skipAdmin || role !== "gateway"),
  );
  const ids = dry
    ? { auth: dryRunDatabaseUuid(), domain: dryRunDatabaseUuid() }
    : {
        auth: inventory.resources.find(
          (row) => row.kind === "d1" && row.name === names.databases.auth,
        )?.cloudId,
        domain: inventory.resources.find(
          (row) => row.kind === "d1" && row.name === names.databases.domain,
        )?.cloudId,
      };
  if (!ids.auth || !ids.domain)
    throw new Error("Branch persistence identifiers are missing");
  let suffix = "preview.local",
    origin = "https://preview.local";
  if (!dry) {
    suffix = subdomain
      ? await subdomain()
      : (
          await createRuntimeCloudClient(
            { accountId: env.CLOUDFLARE_ACCOUNT_ID, workers: [] },
            { env },
          ).api("/workers/subdomain")
        ).subdomain;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(suffix ?? ""))
      throw new Error("Existing account Workers subdomain is required");
    origin = `https://${kinds.includes("gateway") ? names.workers.gateway : names.workers.api}.${suffix}.workers.dev`;
  }
  sourceRoot = resolve(sourceRoot);
  const remap = (path) => {
    if (typeof path !== "string" || !isAbsolute(path)) return path;
    const local = relative(root, path);
    return local.startsWith("..") || isAbsolute(local)
      ? path
      : resolve(sourceRoot, local);
  };
  let assetsDir;
  if (kinds.includes("gateway")) {
    if (dry) {
      assetsDir = join(directory, "empty-assets");
      await mkdir(assetsDir);
    } else
      await run("pnpm", ["--filter", "@savia/admin", "run", "build"], {
        cwd: sourceRoot,
        env,
      });
  }
  const configDir = join(directory, "configs");
  await mkdir(configDir);
  const configs = [],
    selected = new Set(kinds.map((role) => names.workers[role]));
  for (const role of kinds) {
    const config = workerConfig(role, names, ids, origin, {
      assetsDir,
      enableSchedules:
        argv.includes("--enable-schedules") ||
        inventory?.resources.some(
          (row) =>
            row.kind === "cron" && row.parentWorker === names.workers.api,
        ),
    });
    config.main = remap(config.main);
    if (config.assets?.directory)
      config.assets.directory = remap(config.assets.directory);
    if (config.vars) {
      delete config.vars.BETTER_AUTH_BOOTSTRAP_PASSWORD;
      if (!dry && config.vars.SAVIA_MCP_URL?.endsWith(".workers.dev/mcp"))
        config.vars.SAVIA_MCP_URL = `https://${names.workers.mcp}.${suffix}.workers.dev/mcp`;
    }
    if (config.services)
      config.services = config.services.filter(
        (row) =>
          selected.has(row.service) || row.service === "savia-plugin-registry",
      );
    const path = join(configDir, `${role}.json`);
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    configs.push(path);
  }
  const artifact = await freeze({
    environment,
    configs,
    destination: join(directory, "release"),
    domainMigrations: join(sourceRoot, "packages/db/migrations"),
  });
  if (dry) return { status: "prepared-only", environment, ...artifact };
  const planPath = join(directory, "release-plan.json");
  await runEnvironmentOperation(
    parseEnvironmentArgs([
      "plan",
      "--environment",
      environment,
      "--artifact",
      artifact.artifactDirectory,
      "--plan",
      planPath,
    ]),
    deps,
  );
  return {
    ...(await runEnvironmentOperation(
      parseEnvironmentArgs([
        "apply",
        "--environment",
        environment,
        "--artifact",
        artifact.artifactDirectory,
        "--plan",
        planPath,
        "--apply",
      ]),
      deps,
    )),
    artifactDirectory: artifact.artifactDirectory,
  };
}
