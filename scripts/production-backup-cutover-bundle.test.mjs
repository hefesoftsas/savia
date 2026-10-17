import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCutoverUpload,
  parseWorkerBundle,
} from "./production-backup-cutover-bundle.mjs";

const contentType = "multipart/form-data; boundary=cutover-test-boundary";

function part(name, type, bytes) {
  return Buffer.concat([
    Buffer.from(
      `--cutover-test-boundary\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n"),
  ]);
}

function bundle(parts) {
  return Buffer.concat([
    ...parts,
    Buffer.from("--cutover-test-boundary--\r\n"),
  ]);
}

function tinyGateSources() {
  return {
    index: `export function guardStorageEnvironment(env) { return { ...env, guarded: true }; }`,
    control: `export function backupCapability(request) { return new URL(request.url).pathname === "/capability" ? new Response("capability") : null; }
export function handleBackupControl(request) { return new URL(request.url).pathname === "/control" ? new Response("control") : null; }`,
  };
}

test("parseWorkerBundle preserves multipart module bytes, names, and types", async () => {
  const source = Buffer.from("export default { fetch() {} };\r\n");
  const helper = Buffer.from([0, 1, 2, 255]);
  const parsed = await parseWorkerBundle(
    bundle([
      part("index.js", "application/javascript+module", source),
      part("asset.bin", "application/octet-stream", helper),
    ]),
    contentType,
  );
  assert.equal(parsed.mainModule, "index.js");
  assert.deepEqual(
    parsed.modules.map(({ name, type, bytes }) => ({
      name,
      type,
      bytes: Buffer.from(bytes),
    })),
    [
      {
        name: "index.js",
        type: "application/javascript+module",
        bytes: source,
      },
      { name: "asset.bin", type: "application/octet-stream", bytes: helper },
    ],
  );
});

test("parseWorkerBundle fails closed when the JS entry module is ambiguous", async () => {
  await assert.rejects(
    parseWorkerBundle(
      bundle([
        part("worker-a.js", "application/javascript+module", Buffer.from("")),
        part("worker-b.mjs", "application/javascript+module", Buffer.from("")),
      ]),
      contentType,
    ),
    /ambiguous.*entry/i,
  );
});

test("buildCutoverUpload rejects application Durable Object bindings", async () => {
  await assert.rejects(
    buildCutoverUpload({
      snapshot: {
        modules: [
          {
            name: "index.js",
            type: "application/javascript+module",
            bytes: Buffer.from("export default { fetch() {} }"),
          },
        ],
        mainModule: "index.js",
      },
      settings: {
        bindings: [
          {
            type: "durable_object_namespace",
            name: "APP_DO",
            class_name: "ApplicationDurableObject",
          },
        ],
      },
      workerName: "savia-auth",
      gateSources: tinyGateSources(),
    }),
    /unsupported durable object binding/i,
  );
});

test("buildCutoverUpload preserves existing maintenance mode unless explicitly overridden", async () => {
  const base = {
    snapshot: {
      modules: [
        {
          name: "index.js",
          type: "application/javascript+module",
          bytes: Buffer.from("export default { fetch() {} }"),
        },
      ],
      mainModule: "index.js",
    },
    settings: {
      bindings: [
        { type: "plain_text", name: "SAVIA_MAINTENANCE", text: "true" },
      ],
    },
    workerName: "savia-auth",
    gateSources: tinyGateSources(),
  };
  const preserved = await buildCutoverUpload(base);
  const preservedBindings = JSON.parse(
    await preserved.get("metadata").text(),
  ).bindings;
  assert.equal(
    preservedBindings.filter(({ name }) => name === "SAVIA_MAINTENANCE").length,
    1,
  );
  assert.deepEqual(
    preservedBindings.find(({ name }) => name === "SAVIA_MAINTENANCE"),
    { type: "inherit", name: "SAVIA_MAINTENANCE" },
  );

  const overridden = await buildCutoverUpload({ ...base, maintenance: false });
  const overriddenBindings = JSON.parse(
    await overridden.get("metadata").text(),
  ).bindings;
  assert.equal(
    overriddenBindings.filter(({ name }) => name === "SAVIA_MAINTENANCE")
      .length,
    1,
  );
  assert.deepEqual(
    overriddenBindings.find(({ name }) => name === "SAVIA_MAINTENANCE"),
    { type: "plain_text", name: "SAVIA_MAINTENANCE", text: "false" },
  );

  const existingFalse = await buildCutoverUpload({
    ...base,
    settings: {
      bindings: [
        { type: "plain_text", name: "SAVIA_MAINTENANCE", text: "false" },
      ],
    },
  });
  const existingFalseBindings = JSON.parse(
    await existingFalse.get("metadata").text(),
  ).bindings;
  assert.equal(
    existingFalseBindings.filter(({ name }) => name === "SAVIA_MAINTENANCE")
      .length,
    1,
  );
  assert.deepEqual(
    existingFalseBindings.find(({ name }) => name === "SAVIA_MAINTENANCE"),
    { type: "inherit", name: "SAVIA_MAINTENANCE" },
  );
});

test("buildCutoverUpload keeps source bytes and settings bindings while adding the external gate", async () => {
  const source = Buffer.from(
    'export default { fetch() { return new Response("ok"); } };',
  );
  const asset = Buffer.from([0, 9, 255]);
  const settings = {
    compatibility_date: "2026-10-04",
    compatibility_flags: ["nodejs_compat"],
    placement: { mode: "smart" },
    usage_model: "standard",
    logpush: true,
    tail_consumers: [{ service: "tail" }],
    observability: { enabled: true },
    annotations: {
      "workers/message": "previous",
      "workers/tag": "production",
      "workers/triggered_by": "read-only-value",
      unknown_annotation: "discard-this",
    },
    bindings: [
      { type: "secret_text", name: "SECRET_VALUE", text: "should-not-copy" },
      {
        type: "durable_object_namespace",
        name: "REALTIME_HUB",
        class_name: "RealtimeHub",
      },
    ],
  };
  const upload = await buildCutoverUpload({
    snapshot: {
      bundle: bundle([
        part("index.js", "application/javascript+module", source),
        part("asset.bin", "application/octet-stream", asset),
      ]),
      contentType,
    },
    settings,
    workerName: "savia-agencies",
    gateSources: tinyGateSources(),
    maintenance: true,
  });
  const metadata = JSON.parse(await upload.get("metadata").text());
  assert.notEqual(metadata.main_module, "index.js");
  assert.match(
    metadata.main_module,
    /^__savia_cutover_guard_savia-agencies_[a-f0-9-]+\.mjs$/,
  );
  assert.deepEqual(
    metadata.bindings.filter(({ type }) => type === "inherit"),
    settings.bindings.map(({ name }) => ({ type: "inherit", name })),
  );
  assert.deepEqual(
    metadata.bindings.find(({ name }) => name === "BACKUP_GATE"),
    {
      type: "durable_object_namespace",
      name: "BACKUP_GATE",
      script_name: "savia-backup-coordinator",
      class_name: "BackupCoordinator",
    },
  );
  assert.equal(
    metadata.bindings.find(({ name }) => name === "SAVIA_BACKUP_GATE_REQUIRED")
      .text,
    "true",
  );
  assert.equal(
    metadata.bindings.find(({ name }) => name === "SAVIA_MAINTENANCE").text,
    "true",
  );
  for (const key of [
    "compatibility_date",
    "compatibility_flags",
    "placement",
    "usage_model",
    "logpush",
    "tail_consumers",
    "observability",
  ]) {
    assert.deepEqual(metadata[key], settings[key]);
  }
  assert.equal(JSON.stringify(metadata).includes("should-not-copy"), false);
  assert.deepEqual(metadata.annotations, {
    "workers/tag": "production",
    "workers/message":
      "Narrow backup cutover guard for captured savia-agencies bundle",
  });

  const uploadedSource = Buffer.from(
    await upload.get("index.js").arrayBuffer(),
  );
  const uploadedAsset = Buffer.from(
    await upload.get("asset.bin").arrayBuffer(),
  );
  assert.deepEqual(uploadedSource, source);
  assert.deepEqual(uploadedAsset, asset);
  const guard = await upload.get(metadata.main_module).text();
  assert.match(guard, /export \* from "\.\/index\.js"/);
  assert.match(guard, /backupCapability\(request, env\)/);
  assert.match(guard, /guardStorageEnvironment\(env\)/);
  assert.match(
    guard,
    /originalFetch\.call\(original, request, guardedEnv, ctx\)/,
  );
});

test("generated guard delegates requests, preserves original this, and wraps scheduled handlers", async () => {
  const root = await mkdtemp(join(tmpdir(), "cutover-wrapper-"));
  const source = `export const receiver = { fetch(request, env, ctx) { return Response.json({ receiver: this === receiver, guarded: env.guarded, path: new URL(request.url).pathname }); }, scheduled(controller, env, ctx) { return Response.json({ receiver: this === receiver, guarded: env.guarded, scheduled: controller.cron }); } }; export default receiver;`;
  try {
    const upload = await buildCutoverUpload({
      snapshot: {
        modules: [
          {
            name: "index.js",
            type: "application/javascript+module",
            bytes: Buffer.from(source),
          },
        ],
        mainModule: "index.js",
      },
      settings: { bindings: [] },
      workerName: "savia-request",
      gateSources: tinyGateSources(),
    });
    const metadata = JSON.parse(await upload.get("metadata").text());
    for (const [name, value] of upload.entries()) {
      if (name === "metadata") continue;
      await writeFile(join(root, name), Buffer.from(await value.arrayBuffer()));
    }
    const worker = await import(
      `${new URL(`file://${join(root, metadata.main_module)}`).href}?test`
    );
    const fetchResult = await worker.default.fetch(
      new Request("https://example.test/fetch"),
      {},
      {},
    );
    assert.deepEqual(await fetchResult.json(), {
      receiver: true,
      guarded: true,
      path: "/fetch",
    });
    const scheduled = await worker.default.scheduled(
      { cron: "0 * * * *" },
      {},
      {},
    );
    assert.deepEqual(await scheduled.json(), {
      receiver: true,
      guarded: true,
      scheduled: "0 * * * *",
    });
    assert.equal(
      (await worker.default.fetch(new Request("https://x.test/capability"), {}))
        .status,
      200,
    );
    assert.equal(
      await (
        await worker.default.fetch(new Request("https://x.test/control"), {})
      ).text(),
      "control",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
