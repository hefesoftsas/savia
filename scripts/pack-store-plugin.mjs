import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(import.meta.dirname, "..");
const adminNodeModules = join(workspaceRoot, "apps", "admin", "node_modules");
const esbuildBin = join(adminNodeModules, ".bin", "esbuild");

const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

function fail(message) {
  throw new Error(`No se pudo empaquetar el plugin del store: ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${relative(workspaceRoot, path)} no contiene JSON válido.`);
  }
}

function assertManifest(manifest) {
  if (
    !manifest ||
    manifest.format !== "savia.extension" ||
    manifest.formatVersion !== 1 ||
    typeof manifest.id !== "string" ||
    !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(manifest.id) ||
    typeof manifest.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version) ||
    manifest.apiVersion !== 1
  ) {
    fail("savia-extension.json debe ser savia.extension v1 con id válido.");
  }
}

function assertStoreJson(store) {
  if (
    !store ||
    store.format !== "savia.store" ||
    store.formatVersion !== 1 ||
    (store.actions !== undefined && !Array.isArray(store.actions))
  ) {
    fail("store.json debe cumplir el contrato savia.store v1.");
  }
  for (const connector of store.connectors ?? []) {
    if (
      !connector ||
      typeof connector.id !== "string" ||
      typeof connector.label !== "string" ||
      !Array.isArray(connector.allowedHosts) ||
      typeof connector.configSchema !== "object"
    ) {
      fail("store.json tiene un conector mal declarado.");
    }
    const properties = connector.configSchema.properties ?? {};
    for (const field of connector.secretFields ?? []) {
      if (!properties[field]) fail(`Secreto sin declarar: ${field}.`);
    }
  }
  const secretsByConnector = new Map(
    (store.connectors ?? []).map((c) => [
      c?.id,
      new Set(c?.secretFields ?? []),
    ]),
  );
  for (const action of store.actions ?? []) {
    const simulation =
      action &&
      typeof action.id === "string" &&
      action.kind === "simulation" &&
      action.output !== undefined;
    const delegation =
      action &&
      typeof action.id === "string" &&
      action.kind === "delegate" &&
      typeof action.extension === "string" &&
      typeof action.action === "string";
    const http =
      action &&
      typeof action.id === "string" &&
      action.kind === "http" &&
      typeof action.connector === "string" &&
      typeof action.request === "object" &&
      typeof action.request.url === "string";
    const saviaRequest =
      action &&
      typeof action.id === "string" &&
      action.kind === "savia-request" &&
      Array.isArray(action.flows) &&
      action.flows.length > 0 &&
      action.normalize === "insurance-quote";
    if (!simulation && !delegation && !http && !saviaRequest) {
      fail(
        "store.json solo soporta acciones simulation, delegate, http o savia-request declarativas.",
      );
    }
    if (
      http &&
      !(store.connectors ?? []).some((c) => c && c.id === action.connector)
    ) {
      fail(`La acción ${action.id} usa un conector no declarado.`);
    }
    if (http) {
      const secrets = secretsByConnector.get(action.connector) ?? new Set();
      for (const secret of secrets) {
        if (
          typeof action.request.url === "string" &&
          action.request.url.includes(`{{connection.${secret}}}`)
        ) {
          fail(`La acción ${action.id} expone el secreto ${secret} en la URL.`);
        }
      }
    }
  }
}

const FORBIDDEN = [
  [/\beval\s*\(/, "el bundle usa eval()."],
  [/new\s+Function\s*\(|[^.\w$]Function\s*\(/, "el bundle compila código."],
  [/setTimeout\s*\(\s*["'`]/, "el bundle difiere código como texto."],
  [/setInterval\s*\(\s*["'`]/, "el bundle repite código como texto."],
  [/require\s*\(/, "el bundle usa require()."],
  [/\b(D1Database|R2Bucket)\b/, "el bundle accede a bindings."],
  [/\b(Deno|Bun)\s*\./, "el bundle usa runtimes externos."],
  [/localStorage|sessionStorage|indexedDB/, "el bundle usa storage."],
];

function assertBundle(source) {
  const bytes = Buffer.byteLength(source);
  if (bytes > MAX_ENTRY_BYTES)
    fail(`dist/plugin.js supera el máximo de ${MAX_ENTRY_BYTES} bytes.`);
  for (const [pattern, message] of FORBIDDEN) {
    // fetch/geo/lookups relativos los redirige el shell; el directo a
    // terceros sigue prohibido: se detecta por URL absoluta o remoto.
    if (pattern.test(source)) fail(message);
  }
  if (/fetch\s*\(\s*(?:["'`](?!\/)|[^"'`\s)])/.test(source))
    fail("el bundle solo puede usar fetch() con rutas relativas (/api/...).");
  if (/fetch\s*\(\s*["']https?:/.test(source))
    fail("el bundle hace fetch() a URLs remotas.");
  const hasRenderExport =
    /export\s+default\b/.test(source) ||
    /export\s+(async\s+)?function\s+render\b/.test(source) ||
    /export\s+(const|let|var)\s+render\b/.test(source) ||
    /export\s*\{[^}]*\brender\b[^}]*\}/.test(source) ||
    /export\s+(const|let|var)\s+widgets\b/.test(source) ||
    /export\s*\{[^}]*\bwidgets\b[^}]*\}/.test(source);
  if (!hasRenderExport)
    fail("dist/plugin.js debe exportar render() o widgets.");
}

function packageStorePlugin({ portDir, outputPath }) {
  const portRoot = resolve(workspaceRoot, portDir);
  if (!existsSync(portRoot)) fail(`no existe ${portDir}.`);
  const manifest = readJson(join(portRoot, "savia-extension.json"));
  assertManifest(manifest);
  const storePath = join(portRoot, "store.json");
  const store = existsSync(storePath) ? readJson(storePath) : null;
  if (store) assertStoreJson(store);
  const entry =
    ["entry.tsx", "entry.js", "entry.jsx"]
      .map((name) => join(portRoot, name))
      .find((path) => existsSync(path)) ?? "";
  if (!entry) fail("el port debe incluir entry.tsx o entry.js.");

  const temporaryRoot = mkdtempSync(join(tmpdir(), "savia-store-"));
  const stagingRoot = join(temporaryRoot, "plugin");
  const bundlePath = join(stagingRoot, "dist", "plugin.js");
  try {
    mkdirSync(join(stagingRoot, "dist"), { recursive: true });
    execFileSync(
      esbuildBin,
      [
        entry,
        "--bundle",
        "--format=esm",
        "--jsx=automatic",
        "--minify",
        "--loader:.svg=dataurl",
        "--loader:.png=dataurl",
        "--loader:.webp=dataurl",
        `--outfile=${bundlePath}`,
        "--log-level=warning",
      ],
      {
        env: {
          ...process.env,
          NODE_PATH: [adminNodeModules, join(workspaceRoot, "node_modules")]
            .filter((dir) => existsSync(dir))
            .join(":"),
        },
      },
    );
    const stylesheetPath = join(stagingRoot, "dist", "plugin.css");
    if (existsSync(stylesheetPath)) {
      const stylesheet = readFileSync(stylesheetPath, "utf8");
      const entryJs = readFileSync(bundlePath, "utf8");
      writeFileSync(
        bundlePath,
        `const saviaPluginStyle = document.createElement("style");\nsaviaPluginStyle.textContent = ${JSON.stringify(stylesheet)};\ndocument.head.appendChild(saviaPluginStyle);\n${entryJs}`,
      );
    }
    assertBundle(readFileSync(bundlePath, "utf8"));
    cpSync(
      join(portRoot, "savia-extension.json"),
      join(stagingRoot, "savia-extension.json"),
    );
    const zipInputs = ["savia-extension.json", "dist/plugin.js"];
    if (store) {
      cpSync(join(portRoot, "store.json"), join(stagingRoot, "store.json"));
      zipInputs.splice(1, 0, "store.json");
    }
    const artifact = outputPath
      ? resolve(workspaceRoot, outputPath)
      : join(
          workspaceRoot,
          "dist",
          "plugin-store",
          `${manifest.id}-${manifest.version}.store.zip`,
        );
    if (!basename(artifact).endsWith(".zip"))
      fail("el artefacto debe ser .zip.");
    mkdirSync(dirname(artifact), { recursive: true });
    rmSync(artifact, { force: true });
    execFileSync("zip", ["-q", "-X", "-r", artifact, ...zipInputs], {
      cwd: stagingRoot,
    });
    const sha256 = createHash("sha256")
      .update(readFileSync(artifact))
      .digest("hex");
    return {
      artifactPath: relative(workspaceRoot, artifact),
      sha256,
      manifest,
    };
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [portDir, ...rest] = process.argv.slice(2);
    if (
      !portDir ||
      rest.length > 2 ||
      (rest.length === 2 && rest[0] !== "--output")
    ) {
      fail(
        "uso: node scripts/pack-store-plugin.mjs <port-dir> [--output ruta.zip].",
      );
    }
    const result = packageStorePlugin({
      portDir,
      outputPath: rest[1],
    });
    console.log(`Artefacto: ${result.artifactPath}`);
    console.log(`SHA-256: ${result.sha256}`);
    console.log(`Plugin: ${result.manifest.id}@${result.manifest.version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { packageStorePlugin };
