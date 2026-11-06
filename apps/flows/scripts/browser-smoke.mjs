// Local verification only: a synthetic Savia identity, actual host gateway,
// actual Flows Worker, disposable Miniflare storage, and no external egress.
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  createLocalRuntimeOptions,
  applyLocalMigrations,
} from "./dev-local.mjs";
import {
  denyExternalServices,
  createManagedLocalRuntime,
} from "./local-runtime.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
export async function createBrowserSmoke({
  port = 5196,
  directory: existingDirectory,
  secrets,
  flowsBindings = {},
} = {}) {
  const directory =
    existingDirectory ??
    (await mkdtemp(join(tmpdir(), "savia-flows-browser-")));
  const keys =
    secrets ??
    Object.fromEntries(
      ["bridgeSecret", "secretMasterKey", "formSigningKey"].map((key) => [
        key,
        randomBytes(32).toString("hex"),
      ]),
    );
  const fixtureSecret = randomBytes(32).toString("hex");
  const backend = await build({
    entryPoints: [join(root, "scripts/browser-host.test-fixture.ts")],
    nodePaths: [
      join(root, "api/node_modules"),
      join(root, "../api/node_modules"),
    ],
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:workers", "node:*"],
    write: false,
  });
  const bridge = await build({
    stdin: {
      contents: `import {createSaviaFlowsHostBridge} from ${JSON.stringify(join(root, "../admin/src/features/savia-flows/bridge.ts"))};
  const frame=document.querySelector('iframe');
  const host=createSaviaFlowsHostBridge({frame,tenantId:101,origin:location.origin,
    api:{requestResponse:(path,init)=>fetch(path,init)},
    theme:{mode:'light',colorTheme:'emerald',variables:{'--primary':'#08775c','--background':'#fbfcfb','--foreground':'#172b24','--border':'#dbe6df','--muted':'#edf3ef','--muted-foreground':'#65776c','--ring':'#08775c'}}});
  host.start();frame.addEventListener('load',()=>host.start());
  document.querySelector('#theme').onclick=()=>host.setTheme({mode:'dark',colorTheme:'emerald',variables:{'--primary':'#37c69d','--background':'#101c17','--foreground':'#e7f2eb','--border':'#2c4034','--muted':'#1e3026','--muted-foreground':'#9bb0a2','--ring':'#37c69d'}});`,
      resolveDir: root,
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Savia Flows local verification</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#fbfcfb;color:#172b24}header{height:52px;border-bottom:1px solid #dbe6df;display:flex;align-items:center;justify-content:space-between;padding:0 24px}strong{font-size:19px;color:#08775c}header span{font-size:12px;color:#65776c}button{background:#edf3ef;border:1px solid #dbe6df;padding:6px 12px;border-radius:6px;color:inherit}iframe{border:0;width:100%;height:calc(100dvh - 52px)}@media(max-width:600px){header{padding:0 12px}header span{display:none}}</style>
<header><strong>Savia</strong><span>Local verification · synthetic identity · external services disabled</span><button id="theme">Dark theme</button></header><iframe title="Savia Flows" src="/flows-ui/org/tenant:101/workflows"></iframe><script type="module" src="/fixture-bridge.js"></script></html>`;
  const contentTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
  };
  async function assets(request) {
    const url = new URL(request.url);
    if (url.pathname === "/")
      return new Response(html, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/fixture-bridge.js")
      return new Response(bridge.outputFiles[0].text, {
        headers: { "content-type": "text/javascript" },
      });
    if (!url.pathname.startsWith("/flows-ui/"))
      return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(
      url.pathname.slice("/flows-ui/".length),
    );
    const base = resolve(root, "app/dist");
    let path = resolve(base, relative);
    if (!path.startsWith(base + "/") && path !== base)
      return new Response("Not found", { status: 404 });
    if (!extname(path)) path = join(base, "index.html");
    try {
      return new Response(await readFile(path), {
        headers: {
          "content-type":
            contentTypes[extname(path)] ?? "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
  const { options, bootstrapSecret } = await createLocalRuntimeOptions({
    port,
    publicOrigin: `http://127.0.0.1:${port || 5196}`,
    persist: join(directory, "state"),
    registryPath: join(directory, "registry"),
    secrets: keys,
  });
  Object.assign(options.workers[0].bindings, flowsBindings);
  options.workers[0].serviceBindings.SAVIA_HOST = "savia-flows-browser-fixture";
  options.workers.unshift({
    name: "savia-flows-browser-fixture",
    modules: true,
    script: backend.outputFiles[0].text,
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      SAVIA_FLOWS_BRIDGE_SECRET: keys.bridgeSecret,
      FIXTURE_SECRET: fixtureSecret,
    },
    d1Databases: { DB: "savia-flows-browser-host" },
    r2Buckets: { FILES: "savia-flows-browser-files" },
    serviceBindings: { SAVIA_FLOWS: "savia-flows", ASSETS: assets },
    outboundService: denyExternalServices,
  });
  const runtime = createManagedLocalRuntime(options);
  try {
    await runtime.ready;
    await applyLocalMigrations(runtime, bootstrapSecret);
    const coreMigrations = join(root, "../../packages/db/migrations");
    const migrations = await Promise.all(
      (await readdir(coreMigrations))
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map(async (name) => ({
          name,
          statements: (await readFile(join(coreMigrations, name), "utf8"))
            .split("--> statement-breakpoint")
            .map((sql) => sql.replace(/^--.*$/gm, "").trim())
            .filter(Boolean),
        })),
    );
    const response = await runtime.dispatchFetch(
      "http://savia-flows-browser.fixture/_fixture/bootstrap",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + fixtureSecret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ migrations }),
      },
    );
    if (!response.ok) throw new Error("Browser fixture bootstrap failed");
    await response.text();
    return {
      runtime,
      url: await runtime.ready,
      secrets: keys,
      async fixtureRequest(path) {
        return runtime.dispatchFetch(
          "http://savia-flows-browser.fixture/_fixture/" + path,
          {
            method: path === "events" ? "GET" : "POST",
            headers: { authorization: "Bearer " + fixtureSecret },
          },
        );
      },
      async revokeEditor() {
        const response = await runtime.dispatchFetch(
          "http://savia-flows-browser.fixture/_fixture/revoke",
          { headers: { authorization: "Bearer " + fixtureSecret } },
        );
        if (!response.ok) throw new Error("Fixture revocation failed");
        await response.text();
      },
      async dispose() {
        await runtime.dispose();
        if (!existingDirectory)
          await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await runtime.dispose();
    if (!existingDirectory)
      await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const fixture = await createBrowserSmoke({
    port: Number(process.env.SAVIA_FLOWS_BROWSER_PORT ?? 5196),
  });
  console.log(`Local browser verification: ${fixture.url}`);
  const stop = () => void fixture.dispose().finally(() => process.exit());
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
