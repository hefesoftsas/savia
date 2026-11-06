import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
const coreHosts = [
  "apps/api/src",
  "apps/admin/src",
  "apps/mcp/src",
  "apps/provider-gateway/src",
  "apps/connector-gateway/src",
]
  .map((path) => join(repository, path))
  .filter(existsSync);

const forbiddenSolutions = ["insurance", "legacy-api"];
const coreTypecheckPackages = [
  "@savia/api",
  "@savia/admin",
  "@savia/auth",
  "@savia/db",
  "@savia/studio-shared",
  "@savia/studio-server",
  "@savia/mcp",
  "@savia/connector-gateway",
  "@savia/release-catalog",
];
const excludedTypecheckPackages = [
  "@savia/legacy-api",
  "@savia/insurance-quotes",
  "@savia/insurance-portfolio-dashboard",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)
      ? [path]
      : [];
  });
}

function importedSpecifiers(source) {
  const imports = [];
  const expression = /(?:from\s*|import\s*\()(["'])([^"']+)\1/g;
  for (const match of source.matchAll(expression)) imports.push(match[2]);
  return imports;
}

function forbiddenImports(hosts, forbidden) {
  return hosts.flatMap((host) =>
    sourceFiles(host).flatMap((file) =>
      importedSpecifiers(readFileSync(file, "utf8"))
        .filter((specifier) =>
          forbidden.some((solution) => specifier.includes(solution)),
        )
        .map((specifier) => `${relative(repository, file)} -> ${specifier}`),
    ),
  );
}

test("core hosts do not import insurance or legacy implementations", () => {
  const offenders = forbiddenImports(coreHosts, forbiddenSolutions);

  assert.deepEqual(
    offenders,
    [],
    `Core hosts must load industry solutions only through the release catalog:\n${offenders.join("\n")}`,
  );
});

test("core typecheck excludes insurance and legacy packages", () => {
  const packageJson = JSON.parse(
    readFileSync(join(repository, "package.json"), "utf8"),
  );
  const command = packageJson.scripts["typecheck:core"];

  assert.equal(
    typeof command,
    "string",
    "package.json must define typecheck:core",
  );
  for (const packageName of coreTypecheckPackages)
    assert.match(
      command,
      new RegExp(
        `--filter ${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  for (const packageName of excludedTypecheckPackages)
    assert.doesNotMatch(
      command,
      new RegExp(packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
});
