import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { verifyRuntimeArtifact } from "./runtime-publisher.mjs";
import { buildSecretUploads } from "../../scripts/upload-cloudflare-secrets.mjs";
const dataKinds = ["d1", "r2", "kv", "queue", "vectorize"];
const identity = (rows) =>
  JSON.stringify(
    rows
      .map(({ kind, name, cloudId }) => ({ kind, name, cloudId }))
      .sort((a, b) =>
        `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`),
      ),
  );
// This is a first-install gate, never a migration of retained data. A saved
// create-only provision supplies public identities; physical emptiness is read
// again before initializing schema. Backups still run before the final release.
export async function warmupStandardRuntime(
  inputs,
  {
    client,
    env,
    root,
    directory,
    run,
    runWrangler,
    createdWorkers = [],
    fresh = false,
  },
) {
  const artifact = await verifyRuntimeArtifact(inputs);
  const configs = await Promise.all(
    artifact.configs.map(async (file) => ({
      file,
      config: JSON.parse(
        await readFile(join(inputs.artifactDirectory, file), "utf8"),
      ),
    })),
  );
  const bootstrap = fresh;
  if (bootstrap) {
    const proof = inputs.bootstrapProof,
      resources = (inputs.adoptionManifest?.resources ?? []).filter((row) =>
        dataKinds.includes(row.kind),
      );
    if (
      !proof ||
      proof.version !== 1 ||
      proof.accountId !== inputs.accountId ||
      proof.environment !== inputs.environment ||
      identity(proof.resources) !== identity(resources) ||
      !inputs.workers.every((worker) => createdWorkers.includes(worker.name))
    )
      throw new Error(
        "First standard installation requires the exact create-only persistence proof; reconcile partial or retained data before retrying",
      );
    const live = await client.readSnapshot();
    if (live.namespaceIds.length || live.attachments.length)
      throw new Error("Fresh runtime already has data-bearing attachments");
    if ((await client.inspectReferences(inputs.adoptionManifest)).length)
      throw new Error("Fresh persistence has existing runtime callers");
    for (const row of resources) {
      if (row.kind === "d1") {
        const results = await client.api(`/d1/database/${row.cloudId}/query`, {
          method: "POST",
          body: {
            sql: "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV'",
          },
        });
        if (
          !Array.isArray(results) ||
          results.length !== 1 ||
          results[0].success !== true ||
          !Array.isArray(results[0].results) ||
          results[0].results.length
        )
          throw new Error(
            "First installation cannot initialize an existing D1 schema",
          );
      } else if (row.kind === "r2") {
        const objects = await client.api(
          `/r2/buckets/${encodeURIComponent(row.name)}/objects?per_page=1`,
        );
        if (!Array.isArray(objects) || objects.length)
          throw new Error("First installation requires empty R2 storage");
      } else if (row.kind === "kv") {
        const keys = await client.api(
          `/storage/kv/namespaces/${row.cloudId}/keys?limit=1`,
        );
        if (!Array.isArray(keys) || keys.length)
          throw new Error("First installation requires empty KV storage");
      }
    }
    await run(
      "node",
      [
        join(root, "scripts/apply-d1-migrations.mjs"),
        "--migrations-dir",
        join(inputs.artifactDirectory, "migrations"),
      ],
      {
        cwd: root,
        env: { ...env, CLOUDFLARE_DATABASE_ID: env.SAVIA_DOMAIN_D1_ID },
      },
    );
    const flows = configs.find(({ config }) =>
      /^savia-flows(?:-preview)?$/.test(config.name),
    );
    if (flows)
      await runWrangler(
        [
          "d1",
          "migrations",
          "apply",
          flows.config.d1_databases.find((binding) => binding.binding === "DB")
            .database_name,
          "--remote",
          "--config",
          join(inputs.artifactDirectory, flows.file),
        ],
        { cwd: inputs.artifactDirectory, env },
      );
  }
  const uploads = buildSecretUploads(inputs.environment, env);
  for (const upload of bootstrap ? uploads : []) {
    const target = configs.find(({ config }) => config.name === upload.worker);
    if (!target) throw new Error("Warmup secret target is absent");
    await runWrangler(
      [
        "secret",
        "bulk",
        "--config",
        join(inputs.artifactDirectory, target.file),
      ],
      {
        cwd: inputs.artifactDirectory,
        env,
        input: JSON.stringify(upload.secrets),
      },
    );
  }
  const suffix = inputs.environment === "preview" ? "-preview" : "";
  const storageWriters = [
    `savia-auth${suffix}`,
    `savia-request${suffix}`,
    `savia-connectors${suffix}`,
  ];
  const warmupNames = [
    `savia-backup-coordinator${suffix}`,
    `savia-agencies${suffix}`,
    ...storageWriters,
    `savia-flows${suffix}`,
  ];
  if (!bootstrap)
    for (const { config } of configs.filter(({ config }) =>
      warmupNames.includes(config.name),
    )) {
      const settings = await client.api(
        `/workers/scripts/${config.name}/settings`,
      );
      const present = new Set(
        (settings.bindings ?? [])
          .filter((binding) => binding.type === "secret_text")
          .map((binding) => binding.name),
      );
      if ((config.secrets?.required ?? []).some((name) => !present.has(name)))
        throw new Error(
          "Retained maintenance secret custody is incomplete; recover existing keys before publication",
        );
    }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of warmupNames) {
    const target = configs.find(({ config }) => config.name === name);
    if (!target) continue;
    const config = structuredClone(target.config),
      base = dirname(join(inputs.artifactDirectory, target.file));
    config.main = resolve(base, config.main);
    for (const binding of config.d1_databases ?? [])
      if (binding.migrations_dir)
        binding.migrations_dir = resolve(base, binding.migrations_dir);
    if (storageWriters.includes(name)) {
      config.workers_dev = false;
      config.preview_urls = false;
    }
    config.routes = [];
    config.triggers = { crons: [] };
    if (config.queues) config.queues.consumers = [];
    config.vars = {
      ...config.vars,
      SAVIA_RUNTIME_WARMUP: "true",
      SAVIA_MAINTENANCE: "true",
      SAVIA_FLOWS_MAINTENANCE: "true",
      SAVIA_FLOWS_EXECUTION_ENABLED: "false",
    };
    if (config.vars.SAVIA_FLOWS_POLICY_GENERATION)
      config.vars.SAVIA_FLOWS_POLICY_GENERATION = String(
        Number(config.vars.SAVIA_FLOWS_POLICY_GENERATION) - 1,
      );
    // Only authenticated maintenance endpoints are usable; the gateway stays
    // unavailable. Existing backup helpers require the account workers.dev URL.
    const path = join(directory, `${name}.json`);
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    await runWrangler(["deploy", "--config", path], {
      cwd: inputs.artifactDirectory,
      env,
    });
  }
}
