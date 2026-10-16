import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLUGIN_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function git(args, repo) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function jsonAt(repo, revision, path) {
  const source = git(["show", `${revision}:${path}`], repo).toString("utf8");
  return JSON.parse(source);
}

function compareVersions(left, right) {
  const a = left.match(SEMVER);
  const b = right.match(SEMVER);
  if (!a || !b) return null;
  for (let index = 1; index <= 3; index += 1) {
    const leftPart = BigInt(a[index]);
    const rightPart = BigInt(b[index]);
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

function manifestWithoutVersion(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }
  const copy = { ...manifest };
  delete copy.version;
  return JSON.stringify(copy);
}

function pluginDirectory(path) {
  const match = path.match(
    /^(packages\/plugin-[a-z0-9-]+|store-ports\/[a-z0-9-]+)\//,
  );
  return match?.[1] ?? null;
}

function allowedPluginPath(directory, path) {
  const relative = path.slice(directory.length + 1);
  if (relative.startsWith(".")) return false;
  if (relative === "savia-extension.json") return true;
  if (/^(?:src|test|tests|styles|assets|docs)\/(?!\.\.\/).+/.test(relative)) {
    return true;
  }
  if (
    /^[^/]+\.(?:[cm]?[jt]sx?|css)$/.test(relative) &&
    !/(?:^|[.-])(?:config|permissions|schema|manifest|provider|backend|workflow|lock)(?:[.-]|$)/i.test(
      relative,
    )
  ) {
    return true;
  }
  if (/^(?:README|PRODUCT)(?:\.[a-z0-9_-]+)*\.md$/i.test(relative)) return true;
  return false;
}

function flowAffected(path) {
  if (
    path.startsWith("docs/") ||
    path.startsWith("documentation/") ||
    path.startsWith("apps/admin/")
  ) {
    return false;
  }
  const directory = pluginDirectory(path);
  if (directory && allowedPluginPath(directory, path)) return false;
  return true;
}

function documentationOnly(paths) {
  return paths.every(documentationPath);
}

// Repository guidance can accompany a plugin release without making the
// release depend on unrelated core state. Keep this deliberately narrow:
// workflow, config, and infrastructure paths are not ancillary documentation.
function documentationPath(path) {
  return path.startsWith("docs/") || path.startsWith("documentation/");
}

function testsOnly(paths) {
  return paths.every(
    (path) =>
      /(?:^|\/)(?:test|tests|__tests__)\//.test(path) ||
      /\.(?:test|spec)\.[^/]+$/.test(path),
  );
}

function result(kind, flows, plugins, reasons) {
  return {
    kind,
    flows,
    plugins,
    plugin_only: kind === "plugin",
    reasons,
  };
}

/**
 * Classify a git revision range without loading code from either revision.
 * `repo` may be a repository path or an options object with a `repo` property.
 */
export function classifyChanges({ base, head, repo = process.cwd() } = {}) {
  if (repo && typeof repo === "object") repo = repo.repo ?? process.cwd();
  const reasons = [];
  const platform = (reason, paths = []) => {
    const flows = paths.some(flowAffected);
    return result("platform", flows, [], [...reasons, reason]);
  };

  if (typeof base !== "string" || !base || typeof head !== "string" || !head) {
    return platform(
      "A base or head revision was not supplied; running full CI.",
    );
  }

  let paths;
  try {
    const output = git(
      ["diff", "--name-only", "-z", "--no-renames", base, head, "--"],
      repo,
    );
    paths = output.toString("utf8").split("\0").filter(Boolean);
  } catch (error) {
    return platform(
      `Could not read the git diff (${error instanceof Error ? error.message : String(error)}); running full CI.`,
    );
  }

  if (paths.some((path) => path.includes("\ufffd"))) {
    return platform(
      "A changed path is not valid UTF-8; running full CI.",
      paths,
    );
  }
  if (paths.length === 0)
    return result("none", false, [], ["No files changed."]);
  if (documentationOnly(paths)) {
    return result(
      "none",
      paths.some(flowAffected),
      [],
      ["Only documentation files changed."],
    );
  }
  if (testsOnly(paths)) {
    return platform(
      "Only test files changed; running full relevant CI checks.",
      paths,
    );
  }

  const directories = new Set(paths.map(pluginDirectory).filter(Boolean));
  const nonPluginPaths = paths.filter(
    (path) => !pluginDirectory(path) && !documentationPath(path),
  );
  if (nonPluginPaths.length > 0) {
    return platform(
      `Changed files outside eligible plugin directories: ${nonPluginPaths.slice(0, 5).join(", ")}.`,
      paths,
    );
  }

  const plugins = [];
  for (const directory of [...directories].sort()) {
    const manifestPath = `${directory}/savia-extension.json`;
    const storePath = `${directory}/store.json`;
    const packagePath = `${directory}/package.json`;
    let before;
    let after;
    try {
      before = jsonAt(repo, base, manifestPath);
      after = jsonAt(repo, head, manifestPath);
      // Both files are required for both supported directory namespaces. The
      // reads also reject a plugin directory added or removed in this range.
      jsonAt(repo, base, storePath);
      jsonAt(repo, head, storePath);
      if (directory.startsWith("packages/")) {
        jsonAt(repo, base, packagePath);
        jsonAt(repo, head, packagePath);
      }
    } catch (error) {
      return platform(
        `Plugin metadata is missing or malformed in ${directory} (${error instanceof Error ? error.message : String(error)}); running full CI.`,
        paths,
      );
    }

    if (
      !before ||
      !after ||
      typeof before.id !== "string" ||
      !PLUGIN_ID.test(before.id) ||
      before.id !== after.id ||
      typeof before.version !== "string" ||
      typeof after.version !== "string" ||
      !SEMVER.test(before.version) ||
      !SEMVER.test(after.version)
    ) {
      return platform(
        `Invalid extension identity or strict semver in ${directory}.`,
        paths,
      );
    }
    const versionOrder = compareVersions(after.version, before.version);
    if (versionOrder !== 1) {
      return platform(
        `Changed plugin ${directory} must increase its strict semver version (${before.version} -> ${after.version}).`,
        paths,
      );
    }
    if (manifestWithoutVersion(before) !== manifestWithoutVersion(after)) {
      return platform(
        `Manifest fields other than version changed in ${directory}.`,
        paths,
      );
    }

    const unsupported = paths.filter(
      (path) =>
        path.startsWith(`${directory}/`) && !allowedPluginPath(directory, path),
    );
    if (unsupported.length > 0) {
      return platform(
        `Plugin configuration or unsupported files changed in ${directory}: ${unsupported.slice(0, 5).join(", ")}.`,
        paths,
      );
    }
    plugins.push({
      directory,
      id: after.id,
      version: after.version,
      previousVersion: before.version,
    });
  }

  return result("plugin", false, plugins, [
    "All changed files are eligible plugin source or metadata.",
  ]);
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!["--base", "--head", "--output", "--repo"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    parsed[flag.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function writeOutput(outputPath, plan) {
  const lines = [
    `kind=${plan.kind}`,
    `flows=${plan.flows}`,
    `plugins=${JSON.stringify(plan.plugins)}`,
    `plugin_only=${plan.plugin_only}`,
    `reasons=${JSON.stringify(plan.reasons)}`,
  ];
  const contents = `${lines.join("\n")}\n`;
  if (outputPath) writeFileSync(outputPath, contents, { flag: "a" });
  else process.stdout.write(contents);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const plan = classifyChanges(args);
    writeOutput(args.output, plan);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
