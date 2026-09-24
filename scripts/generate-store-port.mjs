import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(import.meta.dirname, "..");
const adminNodeModules = join(workspaceRoot, "apps", "admin", "node_modules");
const esbuildBin = join(adminNodeModules, ".bin", "esbuild");

function fail(message) {
  throw new Error(`No se pudo generar el port: ${message}`);
}

function bumpMinor(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) fail(`versión no semver: ${version}.`);
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function probe(packageDir) {
  const src = join(workspaceRoot, "packages", packageDir, "src");
  const lines = [];
  if (existsSync(join(src, "admin.tsx")) || existsSync(join(src, "admin.ts")))
    lines.push(
      `try { const admin = require(${JSON.stringify(join(src, "admin"))}); screens = (admin.screens ?? []).map((s) => ({ object: s.object, view: s.view ?? "records", hidden: !!s.hidden, component: typeof s.Screen === "function" ? (s.Screen.displayName || s.Screen.name || null) : null })); } catch (error) { screenError = String((error && error.message) || error); }`,
    );
  if (existsSync(join(src, "object.ts")))
    lines.push(
      `try { const req = require(${JSON.stringify(join(src, "object"))}).requirement; requirement = req ? { object: req.object, requiredFields: req.requiredFields ?? {} } : null; } catch (error) { requirementError = String((error && error.message) || error); }`,
    );
  if (existsSync(join(src, "domain.ts")))
    lines.push(
      `try { const domain = require(${JSON.stringify(join(src, "domain"))}); if (domain.defaults !== undefined) defaults = domain.defaults; } catch {}`,
    );
  if (existsSync(join(src, "manifest.ts")))
    lines.push(
      `try { const ext = require(${JSON.stringify(join(src, "manifest"))}).extension; gatewayActions = ((ext && ext.runtime && ext.runtime.actions) ?? []).map((a) => a.actionId); gatewayConnector = ((ext && ext.runtime && ext.runtime.connectors) ?? [])[0]?.connectorId ?? null; } catch (error) { gatewayError = String((error && error.message) || error); }`,
    );
  const probeSource = `let screens = [], screenError = null, requirement = null, requirementError = null, defaults, gatewayActions = [], gatewayConnector = null, gatewayError = null;\n${lines.join("\n")}\nconsole.log(JSON.stringify({ screens, screenError, requirement, requirementError, defaults: defaults ?? null, gatewayActions, gatewayConnector, gatewayError }));\n`;
  const temporaryRoot = mkdtempSync(join(tmpdir(), "savia-port-probe-"));
  try {
    const probePath = join(temporaryRoot, "probe.cjs");
    writeFileSync(probePath, probeSource);
    const bundlePath = join(temporaryRoot, "probe-bundle.cjs");
    execFileSync(
      esbuildBin,
      [
        probePath,
        "--bundle",
        "--platform=node",
        "--format=cjs",
        `--outfile=${bundlePath}`,
        "--log-level=error",
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
    const output = execFileSync("node", [bundlePath], {
      encoding: "utf8",
    });
    return JSON.parse(output);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function entrySource(screens, packageDir) {
  const header = `import { createRoot } from "react-dom/client";
import type { PluginApi } from "../../packages/crm-shared/src/plugin-api";
`;
  if (screens.length === 1) {
    return `${header}import { ${screens[0].component} } from "../../packages/${packageDir}/src/admin";

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<${screens[0].component} savia={savia} />);
}
`;
  }
  const aliases = screens.map((s, i) => ({
    ...s,
    alias: `${s.component}${i > 0 ? i : ""}`,
  }));
  return `${header}import { useState } from "react";
${aliases.map((s) => `import { ${s.component} as ${s.alias} } from "../../packages/${packageDir}/src/admin";`).join("\n")}

const TABS = [
${aliases.map((s) => `  { id: ${JSON.stringify(`${s.object}:${s.view}`)}, label: ${JSON.stringify(s.object)}, Screen: ${s.alias} },`).join("\n")}
] as const;

function Shell({ savia }: { savia: PluginApi }) {
  const [tab, setTab] = useState<string>(TABS[0].id);
  const Active = TABS.find((t) => t.id === tab)!.Screen;
  return (
    <div>
      <nav aria-label="Plugin">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <Active savia={savia} />
    </div>
  );
}

export function render(el: HTMLElement, savia: PluginApi) {
  createRoot(el).render(<Shell savia={savia} />);
}
`;
}

function generatePort({ packageDir, outDir }) {
  const packageRoot = join(workspaceRoot, "packages", packageDir);
  if (!existsSync(packageRoot)) fail(`no existe packages/${packageDir}.`);
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "savia-extension.json"), "utf8"),
  );
  const probed = probe(packageDir);
  if (probed.screenError)
    fail(`no se pudo leer screens de ${packageDir}: ${probed.screenError}`);
  if (!probed.screens.length) fail(`${packageDir} no declara pantallas.`);
  for (const screen of probed.screens) {
    if (!screen.component)
      fail(`pantalla sin componente exportado en ${packageDir}.`);
  }
  if (probed.requirementError)
    fail(`requirement inválido en ${packageDir}: ${probed.requirementError}`);

  const out =
    outDir ??
    join(workspaceRoot, "store-ports", packageDir.replace(/^insurance-/, ""));
  mkdirSync(out, { recursive: true });
  const portManifest = { ...manifest, version: bumpMinor(manifest.version) };
  writeFileSync(
    join(out, "savia-extension.json"),
    `${JSON.stringify(portManifest, null, 2)}\n`,
  );
  writeFileSync(
    join(out, "entry.tsx"),
    entrySource(probed.screens, packageDir),
  );
  const store = { format: "savia.store", formatVersion: 1 };
  if (probed.requirement)
    store.collections = [
      {
        object: probed.requirement.object,
        requiredFields: probed.requirement.requiredFields,
      },
    ];
  store.screens = probed.screens.map((screen) => ({
    object: screen.object,
    view: screen.view,
    ...(screen.hidden ? { hidden: true } : {}),
  }));
  if (probed.defaults !== null && probed.defaults !== undefined)
    store.settings = { defaults: probed.defaults };
  // Puertos gateway: el conector compilado es el relay genérico
  // endpoint+token, que se declara con host configurado.
  let gatewayCount = 0;
  if (probed.gatewayError)
    fail(`no se pudo leer el runtime de ${packageDir}: ${probed.gatewayError}`);
  if (probed.gatewayActions.length) {
    const connectorId = probed.gatewayConnector ?? `${manifest.id}.gateway`;
    store.connectors = [
      {
        id: connectorId,
        label: "Conexión de integración",
        secretFields: ["token"],
        configSchema: {
          type: "object",
          required: ["endpoint", "token"],
          properties: {
            endpoint: { type: "string" },
            token: { type: "string" },
          },
        },
        allowedHosts: [],
        allowConfiguredHost: true,
      },
    ];
    store.actions = probed.gatewayActions.map((actionId) => ({
      id: actionId,
      kind: "http",
      connector: connectorId,
      request: {
        method: "POST",
        url: "{{connection.endpoint}}",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer {{connection.token}}",
          "Idempotency-Key":
            "{{tenant}}:{{extension}}:{{action}}:{{input.operationKey}}",
        },
        body: {
          version: 1,
          extensionId: "{{extension}}",
          actionId: "{{action}}",
          tenantId: "{{tenant}}",
          principalId: "{{principal}}",
          payload: "{{input.payload}}",
        },
      },
    }));
    gatewayCount = probed.gatewayActions.length;
  }
  writeFileSync(join(out, "store.json"), `${JSON.stringify(store, null, 2)}\n`);
  writeFileSync(
    join(out, "README.md"),
    `# Port: ${portManifest.label} (\`${portManifest.id}\` ${portManifest.version})\n\nGenerado con \`pnpm store:port ${packageDir}\` desde el release ${manifest.version}.\n\n\`\`\`bash\npnpm store:pack ${relative(workspaceRoot, out)}\n\`\`\`\n\nSi cambia el paquete original, regenera el port y vuelve a empaquetar.\n`,
  );
  return {
    outDir: relative(workspaceRoot, out),
    manifest: portManifest,
    screens: probed.screens.length,
    collections: probed.requirement ? 1 : 0,
    gatewayActions: gatewayCount,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [packageDir, ...rest] = process.argv.slice(2);
    if (
      !packageDir ||
      (rest.length !== 0 && rest.length !== 2) ||
      (rest.length === 2 && rest[0] !== "--out")
    )
      fail("uso: node scripts/generate-store-port.mjs <paquete> [--out dir].");
    const result = generatePort({
      packageDir,
      outDir: rest[1] ? resolve(workspaceRoot, rest[1]) : undefined,
    });
    console.log(`Port: ${result.outDir}`);
    console.log(`Plugin: ${result.manifest.id}@${result.manifest.version}`);
    console.log(
      `Pantallas: ${result.screens}, colecciones: ${result.collections}, gateway: ${result.gatewayActions}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { generatePort };
