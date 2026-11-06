import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureSpaBuild } from "./measure-spa-build.mjs";

test("measures static startup dependencies once and leaves optional routes out", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-build-metrics-"));
  try {
    await mkdir(join(root, "assets"));
    const files = {
      "index.html":
        '<script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css">',
      "assets/main.js":
        'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/app-abcdefgh.js","assets/app-styles.css","assets/optional.css"])))=>i.map(i=>d[i]); import "./shared.js"; const privateApp=()=>preload(()=>import(`./app-abcdefgh.js`),__vite__mapDeps([0,1])); const later=()=>preload(()=>import("./optional.js"),__vite__mapDeps([2]));',
      "assets/app-styles.css": "body { background: white; }",
      "assets/optional.css": "body { background: red; }",
      "assets/app-abcdefgh.js":
        'import "./shared.js"; console.log("private application");',
      "assets/my-day-page-abcdefgh.js": 'export { value } from "./shared.js";',
      "assets/shared.js": 'export const value = "shared";',
      "assets/optional.js": 'console.log("optional large editor");',
      "assets/main.css": "body { color: black; }",
      "assets/main.js.gz": "sidecar",
    };
    for (const [name, content] of Object.entries(files))
      await writeFile(join(root, name), content);
    const result = await measureSpaBuild(root);
    assert.equal(result.sidecars.bytes, 7);
    assert.equal(result.originals.files, 9);
    assert.equal(result.published.files, 10);
    assert.equal(result.boot.requests, 3);
    assert.equal(result.authenticatedMyDay.requests, 6);
    assert.ok(
      !result.authenticatedMyDay.assets.some((x) =>
        x.name.includes("optional"),
      ),
    );
    assert.equal(
      result.authenticatedMyDay.bytes,
      result.authenticatedMyDay.assets.reduce((n, x) => n + x.bytes, 0),
    );
    assert.ok(result.authenticatedMyDay.gzipBytes > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to report a payload when an emitted static import is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-build-missing-"));
  try {
    await mkdir(join(root, "assets"));
    await writeFile(
      join(root, "index.html"),
      '<script src="/assets/main.js"></script>',
    );
    await writeFile(join(root, "assets/main.js"), 'import "./missing.js";');
    await writeFile(
      join(root, "assets/app-abcdefgh.js"),
      'console.log("app");',
    );
    await writeFile(
      join(root, "assets/my-day-page-abcdefgh.js"),
      'console.log("day");',
    );
    await assert.rejects(measureSpaBuild(root), /Missing dependency/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
