import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeRuntimeRelease } from "./runtime-artifact.mjs";
import { verifyRuntimeArtifact } from "./runtime-publisher.mjs";
test("artifact preparation bundles once and freezes code, assets and both migration histories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-freeze-test-"));
  try {
    const app = join(directory, "app");
    await mkdir(app);
    await mkdir(join(app, "assets"));
    await writeFile(join(app, "assets", "index.html"), "fixture");
    await mkdir(join(app, "sql"));
    await writeFile(join(app, "sql", "0000.sql"), "SELECT 1;");
    await writeFile(join(app, "worker.ts"), "export default {};");
    const path = join(app, "wrangler.json");
    await writeFile(
      path,
      JSON.stringify({
        name: "savia-preview",
        main: "worker.ts",
        assets: { directory: "assets" },
        d1_databases: [{ binding: "DB", migrations_dir: "sql" }],
      }),
    );
    const calls = [];
    const runWrangler = async (args) => {
      calls.push(args);
      const out = args[args.indexOf("--outdir") + 1];
      await writeFile(join(out, "worker.mjs"), "export default {};");
      await writeFile(join(out, "README.md"), String(Math.random()));
      await writeFile(
        join(out, "worker.mjs.map"),
        JSON.stringify({
          version: 3,
          sourceRoot: out,
          sources: [join(app, "worker.ts")],
          sourcesContent: ["export default {};"],
        }),
      );
      await writeFile(
        args[args.indexOf("--metafile") + 1],
        JSON.stringify({
          outputs: { [join(out, "worker.mjs")]: { entryPoint: "worker.ts" } },
        }),
      );
    };
    const artifact = await freezeRuntimeRelease(
      {
        environment: "preview",
        configs: [path],
        destination: join(directory, "artifact"),
        domainMigrations: join(app, "sql"),
      },
      { runWrangler },
    );
    const second = await freezeRuntimeRelease(
      {
        environment: "preview",
        configs: [path],
        destination: join(directory, "artifact-b"),
        domainMigrations: join(app, "sql"),
      },
      { runWrangler },
    );
    assert.equal(artifact.artifactDigest, second.artifactDigest);
    const manifest = await verifyRuntimeArtifact(artifact);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes("--dry-run"));
    const config = JSON.parse(
      await readFile(
        join(artifact.artifactDirectory, manifest.configs[0]),
        "utf8",
      ),
    );
    assert.equal(config.no_bundle, true);
    assert.equal(config.main, "worker.mjs");
    assert.equal(
      await readFile(
        join(artifact.artifactDirectory, "migrations", "0000.sql"),
        "utf8",
      ),
      "SELECT 1;",
    );
    assert.equal(
      await readFile(
        join(
          artifact.artifactDirectory,
          "workers",
          "savia-preview",
          config.assets.directory,
          "index.html",
        ),
        "utf8",
      ),
      "fixture",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
