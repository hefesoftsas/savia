// Explicit disposable integration probe. Never discovers mutation targets by
// prefix: all created names derive from the validated, unique fixture identity.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  realpath,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFixturePrefix } from "../../verify-runtime-lifecycle.mjs";
import { adoptRuntime } from "../../runtime-release.mjs";
import { prepareRuntimeArtifact } from "../../runtime-publisher.mjs";
import { createRuntimeCloudClient } from "../../runtime-cloud.mjs";
import { maintenanceModule } from "../../runtime-maintenance.mjs";

const exec = promisify(execFile);
const [rootArg, prefixArg, mode] = process.argv.slice(2);
if (
  !rootArg ||
  !prefixArg ||
  process.argv.length > 5 ||
  (mode !== undefined && mode !== "--cold-only")
)
  throw new Error(
    "Usage: node probe.mjs <new-private-directory> <savia-iac-fixture-run>",
  );
const prefix = validateFixturePrefix(prefixArg);
const root = resolve(rootArg);
await mkdir(root, { mode: 0o700 }); // Existing directories are deliberately refused.
const source = fileURLToPath(new URL("./", import.meta.url));
const infra = fileURLToPath(new URL("../../", import.meta.url));
const cwd = join(root, "fixtures/runtime");
await cp(source, cwd, { recursive: true });
for (const file of [
  "verify-runtime-lifecycle.mjs",
  "tsconfig.json",
  "runtime-resource.ts",
  "runtime-provider.mjs",
  "runtime-release.mjs",
  "runtime-cloud.mjs",
  "runtime-retirement.mjs",
  "runtime-maintenance.mjs",
  "runtime-publisher.mjs",
  "runtime-bootstrap.mjs",
])
  await cp(join(infra, file), join(root, file));
await symlink(
  await realpath(join(infra, "node_modules")),
  join(root, "node_modules"),
  "dir",
);
await mkdir(join(root, "backend"), { mode: 0o700 });
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^[a-f\d]{32}$/.test(accountId) || !process.env.CLOUDFLARE_API_TOKEN)
  throw new Error("Existing authorized Cloudflare credentials required");
const env = {
  ...process.env,
  PULUMI_BACKEND_URL: `file://${join(root, "backend")}`,
  PULUMI_CONFIG_PASSPHRASE: randomBytes(32).toString("hex"),
};
await writeFile(
  join(root, "passphrase.private"),
  env.PULUMI_CONFIG_PASSPHRASE,
  { mode: 0o600 },
);
const access = randomBytes(32).toString("hex");
env.SAVIA_FIXTURE_ACCESS = access;
const pulumi = process.env.PULUMI_BIN ?? "pulumi";
const wrangler = fileURLToPath(
  new URL("../../../../apps/api/node_modules/.bin/wrangler", import.meta.url),
);
env.SAVIA_FIXTURE_WRANGLER = wrangler;
let sequence = 0;
async function run(binary, args, input) {
  const log = join(root, `${++sequence}-command.private.log`);
  try {
    const pending = exec(binary, args, {
      cwd,
      env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: binary === pulumi ? 20 * 60_000 : 180_000,
    });
    if (input !== undefined) pending.child.stdin.end(input);
    const result = await pending;
    await writeFile(log, result.stdout + result.stderr, { mode: 0o600 });
    return result.stdout;
  } catch (error) {
    await writeFile(
      log,
      String(error.stdout ?? "") + String(error.stderr ?? ""),
      { mode: 0o600 },
    );
    throw new Error(
      `Fixture command ${sequence} failed; private evidence: ${log}`,
    );
  }
}
const p = (...args) => run(pulumi, [...args, "--non-interactive"]);
const config = (key, value) =>
  p("config", "set", key, String(value), "--stack", "fixture");
const up = () => p("up", "--stack", "fixture", "--yes", "--skip-preview");
const cloud = createRuntimeCloudClient({ accountId, workers: [] }, { env });
const api = (path, method = "GET", body) => cloud.api(path, { method, body });
const path = (role) => `/workers/scripts/${prefix}-${role}`;
let data;
let workers;
const configFiles = {};
const secretIdentities = new Set();
function workerSettings(
  role,
  {
    release = "baseline",
    maintenance = false,
    attached = true,
    placeholder = false,
  } = {},
) {
  const settings = {
    name: `${prefix}-${role}`,
    main: "worker.mjs",
    compatibility_date: "2026-10-01",
    workers_dev: role === "gateway" && !maintenance && !placeholder,
    preview_urls: false,
    vars: { RELEASE: release, RETIRED: String(maintenance || placeholder) },
  };
  if (maintenance) settings.main = "maintenance.mjs";
  if (role === "coordinator" && !placeholder) {
    settings.durable_objects = {
      bindings: [{ name: "STORE", class_name: "FixtureStore" }],
    };
    settings.migrations = [{ tag: "v1", new_sqlite_classes: ["FixtureStore"] }];
    settings.d1_databases = [
      {
        binding: "DB",
        database_name: `${prefix}-db`,
        database_id: data.databaseId,
      },
    ];
    settings.r2_buckets = [{ binding: "DATA", bucket_name: data.bucketName }];
    settings.kv_namespaces = [{ binding: "KV", id: data.kvNamespaceId }];
  }
  if (attached && !placeholder) {
    if (role === "gateway")
      settings.services = [
        { binding: "COORDINATOR", service: `${prefix}-coordinator` },
      ];
    if (role === "api") {
      settings.durable_objects = {
        bindings: [
          {
            name: "REMOTE_STORE",
            class_name: "FixtureStore",
            script_name: `${prefix}-coordinator`,
          },
        ],
      };
      settings.services = [{ binding: "AUTH", service: `${prefix}-auth` }];
      settings.triggers = { crons: ["0 0 1 1 *"] };
      settings.queues = { consumers: [{ queue: data.queueName }] };
      settings.workflows = [
        {
          binding: "WORKFLOW",
          name: `${prefix}-workflow`,
          class_name: "FixtureWorkflow",
        },
      ];
    }
    if (role === "auth")
      settings.services = [{ binding: "API", service: `${prefix}-api` }];
    if (role === "coordinator")
      settings.services = [{ binding: "API", service: `${prefix}-api` }];
    if (role === "gateway")
      settings.assets = {
        directory: "assets",
        binding: "ASSETS",
        run_worker_first: true,
      };
  }
  return settings;
}
async function deploy(role, options = {}) {
  const settings = workerSettings(role, options);
  const { maintenance = false, placeholder = false } = options;
  if (maintenance)
    await writeFile(
      join(cwd, "maintenance.mjs"),
      maintenanceModule({
        durableObjectClasses: ["FixtureStore"],
        workflowClasses: ["FixtureWorkflow"],
      }),
    );
  const file = `${role}.wrangler.json`;
  await writeFile(join(cwd, file), JSON.stringify(settings));
  await run(wrangler, ["deploy", "--config", file]);
  const identity = workers.find((w) => w.name === `${prefix}-${role}`)?.cloudId;
  if (!placeholder && !secretIdentities.has(identity)) {
    await run(
      wrangler,
      ["secret", "put", "FIXTURE_ACCESS", "--config", file],
      access,
    );
    secretIdentities.add(identity);
  }
  configFiles[role] = settings;
}
async function snapshot(inputs) {
  const namespaceIds = (await api("/workers/durable_objects/namespaces"))
    .filter((r) => inputs.workers.some((w) => w.name === r.script))
    .map((r) => ({
      workerName: r.script,
      className: r.class,
      namespaceId: r.id,
    }));
  const workerVersions = [];
  for (const w of inputs.workers) {
    const deployments = await api(`/workers/scripts/${w.name}/deployments`);
    const active = deployments.deployments[0].versions;
    assert.equal(active.length, 1, "Fixture must not have split deployments");
    workerVersions.push({ ...w, versionId: active[0].version_id });
  }
  return { workerVersions, namespaceIds, attachments: [] };
}
let origin;
async function values(method = "GET", expectedRelease) {
  // Worker route/version propagation is asynchronous after a new publication.
  // Retry only the synthetic idempotent request, with a bounded deadline.
  for (let attempt = 0; attempt < 13; attempt++) {
    const response = await fetch(origin, {
      method,
      headers: { "x-fixture-access": access },
      body: method === "PUT" ? "synthetic-retained-value" : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 200) {
      const result = await response.json();
      if (!expectedRelease || result.release === expectedRelease) return result;
    } else if (![404, 503].includes(response.status)) {
      throw new Error(
        `Unexpected synthetic endpoint status ${response.status}`,
      );
    }
    await new Promise((done) => setTimeout(done, 5000));
  }
  throw new Error(
    "Synthetic persistence endpoint did not converge within its deadline",
  );
}
const evidence = {};
let initialized = false;
try {
  await p("stack", "init", "fixture", "--secrets-provider", "passphrase");
  initialized = true;
  await config("accountId", accountId);
  await config("fixturePrefix", prefix);
  await up();
  ({ workers, data } = JSON.parse(
    await p("stack", "output", "--json", "--stack", "fixture"),
  ));
  console.log("Fixture identities and isolated data created.");
  if (mode === "--cold-only") {
    await mkdir(join(cwd, "assets"));
    await writeFile(join(cwd, "assets/index.html"), "Synthetic asset");
    const bundle = join(root, "cold-source");
    await mkdir(bundle);
    await cp(join(cwd, "worker.mjs"), join(bundle, "worker.mjs"));
    await cp(join(cwd, "assets"), join(bundle, "assets"), { recursive: true });
    await writeFile(
      join(bundle, "release-behavior.json"),
      JSON.stringify({ injectFailure: false }),
    );
    const configs = {};
    for (const role of ["coordinator", "api", "auth", "gateway"]) {
      const settings = workerSettings(role, {
        release: "first-managed-install",
      });
      configs[`${role}.json`] = settings;
      await writeFile(
        join(cwd, `${role}.wrangler.json`),
        JSON.stringify(settings),
      );
    }
    const artifact = await prepareRuntimeArtifact({
      environment: prefix,
      release: { directory: bundle, configs },
      destination: join(root, "cold-artifact"),
    });
    for (const field of ["artifactDigest", "configDigest", "artifactDirectory"])
      await config(field, artifact[field]);
    await config("runtimeMode", "release");
    await config("adoptRuntime", true);
    await up();
    const result = JSON.parse(
      await p("stack", "output", "--json", "--stack", "fixture"),
    );
    assert.equal(result.runtime.status, "ready");
    assert.equal(result.runtime.namespaceIds.length, 1);
    const subdomain = await api("/workers/subdomain");
    origin = `https://${prefix}-gateway.${subdomain.subdomain}.workers.dev/fixture`;
    await values("PUT");
    const stored = await values("GET", "first-managed-install");
    for (const value of [
      stored.durableObject.value,
      stored.d1,
      stored.r2,
      stored.kv,
    ])
      assert.equal(value, "synthetic-retained-value");
    evidence.firstInstall =
      "managed create bootstrapped cold identities, published cyclic services and allocated namespace with persisted data";
    console.log("Cold managed first installation verified.");
  } else {
    // Native identities may not yet be callable. Always bootstrap private 503
    // placeholders before publishing callers to break service-binding cycles.
    for (const role of ["gateway", "api", "auth", "coordinator"])
      await deploy(role, { placeholder: true });
    await mkdir(join(cwd, "assets"));
    await writeFile(join(cwd, "assets/index.html"), "Synthetic asset");
    for (const role of ["coordinator", "api", "auth", "gateway"])
      await deploy(role);
    const subdomain = await api("/workers/subdomain");
    origin = `https://${prefix}-gateway.${subdomain.subdomain}.workers.dev/fixture`;
    await values("PUT");
    const original = await values();
    for (const value of [
      original.durableObject.value,
      original.d1,
      original.r2,
      original.kv,
    ])
      assert.equal(value, "synthetic-retained-value");
    const inputs = {
      accountId,
      environment: prefix,
      workers,
      mode: "adopt",
      adoptionManifest: {
        accountId,
        environment: prefix,
        resources: workers.map((w) => ({ kind: "worker", ...w })),
      },
    };
    const deps = { readSnapshot: snapshot };
    const before = await snapshot(inputs);
    const adopted = await adoptRuntime(inputs, deps);
    assert.deepEqual(adopted.workerVersions, before.workerVersions);
    assert.deepEqual(adopted.namespaceIds, before.namespaceIds);
    await config("adoptRuntime", true);
    await up();
    await p(
      "preview",
      "--stack",
      "fixture",
      "--refresh",
      "--expect-no-changes",
    );
    evidence.adoption = "read-only versions and namespace identities preserved";
    console.log("Read-only adoption and unchanged native refresh verified.");
    const adoptedOutput = JSON.parse(
      await p("stack", "output", "--json", "--stack", "fixture"),
    ).runtime;
    async function artifact(marker, injectFailure) {
      const bundle = join(root, `source-${marker}`);
      await mkdir(bundle);
      await cp(join(cwd, "worker.mjs"), join(bundle, "worker.mjs"));
      await cp(join(cwd, "assets"), join(bundle, "assets"), {
        recursive: true,
      });
      await writeFile(
        join(bundle, "release-behavior.json"),
        JSON.stringify({ injectFailure }),
      );
      const configs = Object.fromEntries(
        Object.entries(configFiles).map(([role, settings]) => [
          `${role}.json`,
          { ...settings, vars: { ...settings.vars, RELEASE: marker } },
        ]),
      );
      return prepareRuntimeArtifact({
        environment: prefix,
        release: { directory: bundle, configs },
        destination: join(root, `artifact-${marker}`),
      });
    }
    async function selectArtifact(prepared) {
      for (const field of [
        "artifactDigest",
        "configDigest",
        "artifactDirectory",
      ])
        await config(field, prepared[field]);
      await config("runtimeMode", "release");
    }
    const successfulArtifact = await artifact("updated", false);
    await selectArtifact(successfulArtifact);
    await up();
    const updatedOutput = JSON.parse(
      await p("stack", "output", "--json", "--stack", "fixture"),
    ).runtime;
    assert.equal(updatedOutput.id, adoptedOutput.id);
    assert.equal(updatedOutput.status, "ready");
    assert.deepEqual(updatedOutput.namespaceIds, adoptedOutput.namespaceIds);
    assert.equal((await values("GET", "updated")).release, "updated");
    const stable = await snapshot(inputs);
    const failingArtifact = await artifact("bad", true);
    await selectArtifact(failingArtifact);
    await assert.rejects(up(), /Fixture command .*failed/);
    const failureLog = await readFile(
      join(root, `${sequence}-command.private.log`),
      "utf8",
    );
    assert.match(failureLog, /Injected managed publication failure/);
    assert.deepEqual(
      (await snapshot(inputs)).workerVersions,
      stable.workerVersions,
    );
    assert.equal((await values("GET", "updated")).release, "updated");
    await selectArtifact(successfulArtifact);
    await p(
      "preview",
      "--stack",
      "fixture",
      "--refresh",
      "--expect-no-changes",
    );
    evidence.updateAndRecovery =
      "managed Pulumi update preserved runtime ID; failed update restored actual versions";
    await config("retired", true);
    await up();
    const retained = JSON.parse(
      await p("stack", "output", "--json", "--stack", "fixture"),
    );
    assert.equal(retained.workers.length, 1);
    assert.equal(
      retained.workers[0].cloudId,
      workers.find((w) => w.name.endsWith("-coordinator")).cloudId,
    );
    assert.deepEqual(retained.data, data);
    await config("adoptRuntime", false);
    await config("retired", false);
    await up();
    ({ workers } = JSON.parse(
      await p("stack", "output", "--json", "--stack", "fixture"),
    ));
    for (const role of ["gateway", "api", "auth"])
      await deploy(role, { placeholder: true });
    for (const role of ["coordinator", "api", "auth", "gateway"])
      await deploy(role, { release: "recreated" });
    await config("runtimeMode", "adopt");
    await config("adoptRuntime", true);
    await up();
    const after = await values();
    for (const value of [
      after.durableObject.value,
      after.d1,
      after.r2,
      after.kv,
    ])
      assert.equal(value, "synthetic-retained-value");
    assert.deepEqual(
      (await snapshot({ ...inputs, workers })).namespaceIds,
      stable.namespaceIds,
    );
    evidence.retainedData =
      "DO namespace and value, D1, R2 and KV values survived retirement/recreation";
    console.log("Data-preserving retirement and recreation verified.");
  }
} finally {
  // All cleanup is restricted to this operation's exact resources.
  if (initialized) {
    try {
      if (data) {
        for (const role of ["api", "auth", "gateway", "coordinator"]) {
          try {
            await deploy(role, { maintenance: true, attached: false });
          } catch {
            /* A partially created identity may have no published code. Native deletion will still be checked. */
          }
        }
        try {
          await api(`/workflows/${prefix}-workflow`, "DELETE");
        } catch {
          /* Verified absent by final inventory. */
        }
        const consumers = await api(`/queues/${data.queueId}/consumers`);
        for (const consumer of consumers)
          await api(
            `/queues/${data.queueId}/consumers/${consumer.consumer_id}`,
            "DELETE",
          );
        // Empty the one synthetic R2 key through its authenticated fixture code
        // before native bucket deletion; use the exact account/bucket API below.
        await run(wrangler, [
          "r2",
          "object",
          "delete",
          `${data.bucketName}/synthetic`,
          "--remote",
        ]);
      }
      await config("deleteData", true);
      await up();
      await p("destroy", "--stack", "fixture", "--yes", "--skip-preview");
      const all = await api("/workers/workers?per_page=100");
      assert.equal(
        all.filter((w) =>
          ["gateway", "api", "auth", "coordinator"].some(
            (role) => w.name === `${prefix}-${role}`,
          ),
        ).length,
        0,
      );
      const namespaces = await api("/workers/durable_objects/namespaces");
      assert.equal(
        namespaces.filter((n) => n.script === `${prefix}-coordinator`).length,
        0,
      );
      await p("stack", "rm", "fixture", "--yes");
      evidence.cleanup = "native force:false cleanup complete";
      console.log("Fixture cleanup complete.");
    } catch (error) {
      await writeFile(join(root, "cleanup-failed.private.log"), String(error), {
        mode: 0o600,
      });
      throw error;
    } finally {
      await writeFile(
        join(root, "evidence.private.json"),
        JSON.stringify(evidence, null, 2),
        { mode: 0o600 },
      );
    }
  }
}
