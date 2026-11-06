import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { runTests } from "@vscode/test-electron";
const app = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = resolve(app, "../..");
const temporary = await fs.mkdtemp(join(tmpdir(), "savia-extension-host-"));
let fixture;
try {
  const stage = join(temporary, "extension");
  execFileSync(
    process.execPath,
    [join(app, "scripts/build.mjs"), "--stage", stage],
    { stdio: "inherit" },
  );
  const runner = join(stage, "dist/host-proof.cjs");
  await build({
    entryPoints: [join(app, "test/extension-host/smoke.ts")],
    outfile: runner,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["vscode"],
    sourcemap: false,
  });
  const manifest = JSON.parse(
    await fs.readFile(join(stage, "package.json"), "utf8"),
  );
  manifest.main = "./dist/host-proof.cjs";
  await fs.writeFile(join(stage, "package.json"), JSON.stringify(manifest));
  const serverModule = join(temporary, "server.cjs");
  await build({
    entryPoints: [join(app, "test/extension-host/server.ts")],
    outfile: serverModule,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["wrangler"],
    sourcemap: false,
  });
  // External Node dependencies resolve from the workspace, not from a system installation.
  await fs.symlink(
    join(app, "node_modules"),
    join(temporary, "node_modules"),
    "dir",
  );
  const serverPackage = await import(serverModule);
  const startHostFixture =
    serverPackage.startHostFixture ?? serverPackage.default.startHostFixture;
  fixture = await startHostFixture(repo);
  const root = join(temporary, "project");
  await fs.mkdir(root);
  const configuration = join(temporary, "fixture.json");
  await fs.writeFile(
    configuration,
    JSON.stringify({ ...fixture, close: undefined, root }),
    { mode: 0o600 },
  );
  const result = await runTests({
    version: "1.96.2",
    cachePath: join(app, ".vscode-test"),
    reuseMachineInstall: false,
    extensionDevelopmentPath: stage,
    extensionTestsPath: runner,
    extensionTestsEnv: { SAVIA_HOST_FIXTURE: configuration },
    launchArgs: [
      root,
      "--user-data-dir",
      join(temporary, "user-data"),
      "--extensions-dir",
      join(temporary, "extensions"),
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-telemetry",
      "--no-sandbox",
    ],
  });
  if (result !== 0) throw new Error(`Extension Host exited ${result}`);
} finally {
  await fixture?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
