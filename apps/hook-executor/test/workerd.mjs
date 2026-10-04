import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures } from "../../../docs/experiments/savia-hooks-quickjs/fixtures.mjs";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const wrangler = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } =
  wrangler("miniflare");
const { build } = wrangler("esbuild");
let mf, directory;
before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), "savia-hooks-workerd-"));
    await promisify(execFile)(
      process.execPath,
      [
        join(
          dirname(require.resolve("wrangler/package.json")),
          "bin/wrangler.js",
        ),
        "deploy",
        "--dry-run",
        "--outdir",
        directory,
      ],
      { cwd: app, env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" } },
    );
    const caller = join(directory, "caller.js");
    await build({
      stdin: {
        contents: `import {hook} from ${JSON.stringify(resolve(app, "../savia-request/src/server/hooks.ts"))};
      export default {async fetch(request, env){const {code,payload}=await request.json();
      try{return Response.json(await hook(env,code,payload))}catch{return new Response('Hook rejected',{status:422})}}};`,
        resolveDir: app,
        sourcefile: "caller.ts",
      },
      bundle: true,
      outfile: caller,
      format: "esm",
      platform: "browser",
      target: "es2022",
    });
    const assets = await readdir(directory);
    mf = new Miniflare(
      convertV4MiniflareOptions({
        log: new Log(LogLevel.ERROR),
        workers: [
          {
            name: "caller",
            compatibilityDate: "2026-09-04",
            modulesRoot: directory,
            modules: [{ type: "ESModule", path: caller }],
            serviceBindings: { HOOK_SERVICE: "hook-executor" },
          },
          {
            name: "hook-executor",
            compatibilityDate: "2026-09-04",
            modulesRoot: directory,
            modules: [
              { type: "ESModule", path: join(directory, "index.js") },
              ...assets
                .filter((name) => name.endsWith(".wasm"))
                .map((name) => ({
                  type: "CompiledWasm",
                  path: join(directory, name),
                })),
            ],
          },
        ],
      }),
    );
    await mf.ready;
  },
  { timeout: 30_000 },
);
after(async () => {
  await mf?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function run(fixture) {
  return mf.dispatchFetch("https://caller.internal/", {
    method: "POST",
    body: JSON.stringify(fixture),
  });
}

test("actual Savia service client executes all 51 catalog hooks in ordinary workerd", async () => {
  assert.equal(fixtures.length, 51);
  for (const fixture of fixtures) {
    const response = await run(fixture);
    assert.equal(response.status, 200, fixture.name);
    const result = await response.json();
    assert.equal(typeof result.body, "string");
    assert.ok(
      Object.values(result.variables).every(
        (value) => typeof value === "string",
      ),
    );
    if (fixture.name === "liberty-get-oauth-token/0/post")
      assert.equal(
        result.variables.liberty_autos_access_token,
        "synthetic-token",
      );
  }
});

test("private binding preserves payload and does not reuse guest globals", async () => {
  const payload = { body: "hello", values: {} };
  await run({ code: 'globalThis.secret="first-caller";', payload });
  const response = await run({
    code: 'req.setBody(req.getBody()+":"+typeof globalThis.secret);bru.setVar("ok",true)',
    payload,
  });
  assert.deepEqual(await response.json(), {
    body: "hello:undefined",
    variables: { ok: "true" },
  });
});

test("private binding accepts a two-million-character response", async () => {
  const response = await run({
    code: 'bru.setVar("size",res.getBody().length)',
    payload: { body: "", values: {}, response: "x".repeat(2_000_000) },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).variables.size, "2000000");
});
