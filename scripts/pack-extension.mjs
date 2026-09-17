import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(import.meta.dirname, "..");
const packagesRoot = resolve(workspaceRoot, "packages");
const artifactRoot = resolve(workspaceRoot, "dist", "extensions");

function fail(message) {
  throw new Error(`No se pudo empaquetar la extensión: ${message}`);
}

function readManifest(extensionRoot) {
  const manifestPath = join(extensionRoot, "savia-extension.json");
  if (!existsSync(manifestPath)) fail("falta savia-extension.json.");

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("savia-extension.json no contiene JSON válido.");
  }

  if (
    !manifest ||
    manifest.format !== "savia.extension" ||
    manifest.formatVersion !== 1 ||
    typeof manifest.id !== "string" ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(manifest.id) ||
    typeof manifest.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version) ||
    typeof manifest.label !== "string" ||
    typeof manifest.description !== "string" ||
    !Array.isArray(manifest.requires) ||
    !manifest.requires.every(
      (requirement) => typeof requirement === "string",
    ) ||
    manifest.apiVersion !== 1
  ) {
    fail("savia-extension.json no cumple el contrato savia.extension v1.");
  }

  return manifest;
}

function extensionRootFor(directoryName) {
  if (!/^[a-z0-9-]+$/.test(directoryName)) {
    fail("el directorio debe ser un nombre simple dentro de packages/.");
  }
  const extensionRoot = resolve(packagesRoot, directoryName);
  if (dirname(extensionRoot) !== packagesRoot || !existsSync(extensionRoot)) {
    fail(`no existe packages/${directoryName}.`);
  }
  return extensionRoot;
}

function artifactPathFor(outputPath, manifest) {
  const candidate = outputPath
    ? resolve(workspaceRoot, outputPath)
    : join(
        artifactRoot,
        `${manifest.id}-${manifest.version}.savia-extension.zip`,
      );
  const artifactRelativePath = relative(artifactRoot, candidate);
  if (
    artifactRelativePath.startsWith("..") ||
    isAbsolute(artifactRelativePath) ||
    !basename(candidate).endsWith(".zip")
  ) {
    fail("el artefacto debe ser un archivo .zip dentro de dist/extensions/.");
  }
  return candidate;
}

function assertNoSymbolicLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`no se permiten enlaces simbólicos (${entryPath}).`);
    }
    if (entry.isDirectory()) assertNoSymbolicLinks(entryPath);
  }
}

function packageRelease({ directoryName, outputPath }) {
  const extensionRoot = extensionRootFor(directoryName);
  const manifest = readManifest(extensionRoot);
  const sourceDirectory = join(extensionRoot, "src");
  const packageJsonPath = join(extensionRoot, "package.json");
  if (!existsSync(sourceDirectory) || !existsSync(packageJsonPath)) {
    fail("la extensión debe incluir package.json y src/.");
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (
    typeof packageJson.name !== "string" ||
    !packageJson.name.startsWith("@savia/")
  ) {
    fail("package.json debe declarar un paquete @savia/.");
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "savia-extension-"));
  const stagingRoot = join(temporaryRoot, "savia-extension");
  const normalizedOutput = artifactPathFor(outputPath, manifest);

  try {
    mkdirSync(stagingRoot, { recursive: true });
    cpSync(sourceDirectory, join(stagingRoot, "src"), { recursive: true });
    cpSync(packageJsonPath, join(stagingRoot, "package.json"));
    cpSync(
      join(extensionRoot, "tsconfig.json"),
      join(stagingRoot, "tsconfig.json"),
    );
    cpSync(
      join(extensionRoot, "savia-extension.json"),
      join(stagingRoot, "savia-extension.json"),
    );
    assertNoSymbolicLinks(stagingRoot);

    const release = {
      format: "savia.extension.release",
      formatVersion: 1,
      packageName: packageJson.name,
      manifest,
      entryPoints: ["src/admin.ts", "src/mcp.ts"],
    };
    writeFileSync(
      join(stagingRoot, "release.json"),
      `${JSON.stringify(release, null, 2)}\n`,
    );

    const inputFiles = [
      "package.json",
      "release.json",
      "savia-extension.json",
      "src",
      "tsconfig.json",
    ];
    mkdirSync(dirname(normalizedOutput), { recursive: true });
    rmSync(normalizedOutput, { force: true });
    execFileSync("zip", ["-q", "-X", "-r", normalizedOutput, ...inputFiles], {
      cwd: stagingRoot,
    });

    const sha256 = createHash("sha256")
      .update(readFileSync(normalizedOutput))
      .digest("hex");
    return {
      artifactPath: relative(workspaceRoot, normalizedOutput),
      sha256,
      manifest,
    };
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function parseArguments(argumentsList) {
  const [directoryName, ...remaining] = argumentsList;
  if (!directoryName || remaining.length > 2) {
    fail(
      "uso: pnpm extension:pack <directorio> [--output ruta/al/artefacto.zip].",
    );
  }
  if (remaining.length === 0) return { directoryName };
  if (remaining[0] !== "--output" || !remaining[1]) {
    fail(
      "uso: pnpm extension:pack <directorio> [--output ruta/al/artefacto.zip].",
    );
  }
  return { directoryName, outputPath: remaining[1] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = packageRelease(parseArguments(process.argv.slice(2)));
    console.log(`Artefacto: ${result.artifactPath}`);
    console.log(`SHA-256: ${result.sha256}`);
    console.log(`Extensión: ${result.manifest.id}@${result.manifest.version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { artifactPathFor, assertNoSymbolicLinks, packageRelease, readManifest };
