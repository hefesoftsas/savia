import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "coverage");

export function discoverProjects() {
  return ["apps", "packages"]
    .flatMap((base) =>
      readdirSync(join(root, base), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(join(root, base, entry.name, "package.json")) &&
            existsSync(join(root, base, entry.name, "src")),
        )
        .map((entry) => {
          const path = `${base}/${entry.name}`;
          const pkg = JSON.parse(
            readFileSync(join(root, path, "package.json"), "utf8"),
          );
          const group =
            entry.name === "admin"
              ? "admin"
              : entry.name === "api"
                ? "api"
                : entry.name === "studio-server"
                  ? "studio"
                  : entry.name.startsWith("insurance-")
                    ? "insurance"
                    : "core";
          return {
            path,
            group,
            provider: pkg.devDependencies?.["@cloudflare/vitest-plugin"]
              ? "istanbul"
              : "v8",
            hasTests: Boolean(pkg.scripts?.test?.includes("vitest")),
          };
        }),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function mergeCoverage(maps) {
  const merged = libCoverage.createCoverageMap({});
  for (const map of maps) merged.merge(map);
  return merged;
}

function sourceFingerprint() {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "-co",
      "--exclude-standard",
      "-z",
      "--",
      "apps",
      "packages",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "scripts/coverage.mjs",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error("Cannot fingerprint coverage sources: git ls-files failed");
  const hash = createHash("sha256");
  for (const file of [
    ...new Set(result.stdout.split("\0").filter(Boolean)),
  ].sort()) {
    hash.update(file).update("\0");
    hash.update(
      existsSync(join(root, file))
        ? readFileSync(join(root, file))
        : "<deleted>",
    );
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function coverageIssues(projects, statuses, fingerprint) {
  const issues = [];
  for (const { path } of projects) {
    const runs = statuses.filter((s) => s.project === path);
    if (!runs.length) {
      issues.push(`${path}: missing report`);
      continue;
    }
    if (fingerprint && runs.some((s) => s.fingerprint !== fingerprint))
      issues.push(
        `${path}: stale or incompatible source snapshot; rerun coverage`,
      );
    if (runs.some((s) => s.exitCode !== 0 || !s.hasReport))
      issues.push(`${path}: failed tests or missing coverage`);
    if (runs.length === 1 && runs[0].shard === "full") continue;
    const parts = runs.map((s) => /^(\d+)\/(\d+)$/.exec(s.shard));
    const total = Number(parts[0]?.[2]);
    if (
      parts.some(
        (p) =>
          !p ||
          Number(p[2]) !== total ||
          Number(p[1]) < 1 ||
          Number(p[1]) > total,
      ) ||
      runs.length !== total ||
      new Set(parts.map((p) => p?.[1])).size !== total
    ) {
      issues.push(`${path}: missing, duplicate, or incompatible shards`);
    }
  }
  return issues;
}

function report() {
  const raw = join(output, "raw");
  const statuses = [];
  const maps = [];
  for (const name of existsSync(raw) ? readdirSync(raw) : []) {
    const directory = join(raw, name);
    if (!existsSync(join(directory, "status.json"))) continue;
    const status = JSON.parse(
      readFileSync(join(directory, "status.json"), "utf8"),
    );
    const file = join(directory, "coverage-final.json");
    statuses.push({ ...status, hasReport: existsSync(file) });
    if (existsSync(file)) maps.push(JSON.parse(readFileSync(file, "utf8")));
  }
  const issues = coverageIssues(
    discoverProjects(),
    statuses,
    sourceFingerprint(),
  );
  const merged = mergeCoverage(maps);
  const context = libReport.createContext({ dir: output, coverageMap: merged });
  for (const name of ["html", "lcovonly", "json-summary", "text-summary"])
    reports.create(name).execute(context);
  const summary = merged.getCoverageSummary();
  const lines = [
    "# Test coverage",
    "",
    issues.length
      ? "**INCOMPLETE / FAILED — these percentages are diagnostic, not the full baseline.**"
      : "All workspace coverage runs completed successfully.",
    "",
    "Scope: each workspace's src JavaScript/TypeScript measured by its own Vitest suite, including untested files. Cross-workspace imports are credited in their owning workspace's suite only.",
    "",
    "| Metric | Covered | Total | Coverage |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const metric of ["lines", "statements", "functions", "branches"]) {
    const value = summary[metric];
    lines.push(
      `| ${metric} | ${value.covered} | ${value.total} | ${value.pct}% |`,
    );
  }
  lines.push(
    "",
    "Not measured: Node contract/script tests, Rust, SQL, store-ports, generated code, declarations, and test files.",
    "",
    "Download the coverage-report artifact and open index.html for the per-file report.",
  );
  if (issues.length)
    lines.push(
      "",
      "## Incomplete runs",
      "",
      ...issues.map((issue) => `- ${issue}`),
    );
  writeFileSync(join(output, "summary.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  return issues.length ? 1 : 0;
}

function run(values) {
  const projects = discoverProjects().filter(
    (project) => !values.group || project.group === values.group,
  );
  if (!projects.length)
    throw new Error(`Unknown coverage group: ${values.group}`);
  if (
    values.shard &&
    (!values.group ||
      !/^[1-9]\d*\/[1-9]\d*$/.test(values.shard) ||
      Number(values.shard.split("/")[0]) > Number(values.shard.split("/")[1]))
  )
    throw new Error("Use --group with a valid --shard index/count");
  if (!values.group) rmSync(output, { recursive: true, force: true });
  const fingerprint = sourceFingerprint();
  let failed = false;
  for (const project of projects) {
    const shard = values.shard ?? "full";
    const directory = join(
      output,
      "raw",
      `${project.path.replaceAll("/", "-")}-${shard.replace("/", "-of-")}`,
    );
    rmSync(directory, { recursive: true, force: true });
    const args = [
      "exec",
      "vitest",
      "run",
      "--maxWorkers=1",
      "--coverage.enabled",
      `--coverage.provider=${project.provider}`,
      "--coverage.include=src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
      "--coverage.exclude=**/*.d.ts",
      "--coverage.exclude=**/*.{test,spec}.*",
      "--coverage.exclude=**/{test,tests,__tests__,generated}/**",
      "--coverage.reporter=json",
      "--coverage.reportOnFailure",
      `--coverage.reportsDirectory=${directory}`,
    ];
    if (!project.hasTests) args.push("--passWithNoTests");
    if (values.shard) args.push(`--shard=${values.shard}`);
    // The gateway's regular command limits discovery to test/.
    if (project.path === "apps/connector-gateway") args.push("test");
    console.log(`\nCoverage: ${project.path} (${shard})`);
    const result = spawnSync("pnpm", args, {
      cwd: join(root, project.path),
      stdio: "inherit",
      timeout: 20 * 60 * 1000,
    });
    const exitCode = result.status ?? 1;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "status.json"),
      JSON.stringify(
        { project: project.path, shard, exitCode, fingerprint },
        null,
        2,
      ),
    );
    if (result.error) console.error(result.error.message);
    failed ||= exitCode !== 0;
  }
  if (!values.group) return report() || Number(failed);
  return Number(failed);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { group: { type: "string" }, shard: { type: "string" } },
    });
    if (positionals.length !== 1 || !["run", "report"].includes(positionals[0]))
      throw new Error(
        "Usage: node scripts/coverage.mjs run [--group admin|api|core|insurance|studio] [--shard 1/2] | report",
      );
    process.exitCode = positionals[0] === "report" ? report() : run(values);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
