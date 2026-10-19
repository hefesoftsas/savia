import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { settledCheckpoint } from "./management-resources.mjs";
import { normalizeEnvironmentPlan } from "./environment-plan.mjs";
import { assertBookkeepingPlan } from "./environment-ownership.mjs";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

// Run real engine operations only against disposable local files. Never inherit
// backend, provider credentials, login sessions or executable Node options.
export async function runCliPreflight({
  pulumi = process.env.SAVIA_PULUMI_COMMAND ?? "pulumi",
  tempRoot = tmpdir(),
} = {}) {
  const root = await mkdtemp(join(tempRoot, "savia-cli-preflight-"));
  try {
    const backend = join(root, "backend"),
      source = join(root, "source"),
      destination = join(root, "destination"),
      home = join(root, "home");
    await Promise.all(
      [backend, source, destination, home].map((path) =>
        mkdir(path, { mode: 0o700 }),
      ),
    );
    const env = {
      PATH: process.env.PATH,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USER: "savia-preflight",
      LOGNAME: "savia-preflight",
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      TMPDIR: root,
      TMP: root,
      TEMP: root,
      PULUMI_HOME: join(home, ".pulumi"),
      PULUMI_BACKEND_URL: pathToFileURL(backend).href,
      PULUMI_CONFIG_PASSPHRASE: randomBytes(32).toString("hex"),
      PULUMI_SKIP_UPDATE_CHECK: "true",
      PULUMI_DISABLE_AUTOMATIC_PLUGIN_ACQUISITION: "true",
    };
    const command = async (stage, cwd, args) => {
      try {
        return (
          await execute(pulumi, args, {
            cwd,
            env,
            timeout: 120_000,
            maxBuffer: 16 * 1024 * 1024,
          })
        ).stdout;
      } catch (cause) {
        throw new Error(`Pulumi CLI preflight failed at ${stage}`, { cause });
      }
    };
    const version = (await command("version", source, ["version"])).trim();
    assert.equal(
      version,
      "v3.268.0",
      "Use the repository-pinned Pulumi CLI 3.268.0",
    );
    const sdk = require.resolve("@pulumi/pulumi"),
      sdkVersion = JSON.parse(
        await readFile(require.resolve("@pulumi/pulumi/package.json"), "utf8"),
      ).version;
    for (const [directory, project] of [
      [source, "savia-cloudflare"],
      [destination, "savia-management"],
    ]) {
      await symlink(
        fileURLToPath(new URL("./node_modules", import.meta.url)),
        join(directory, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await writeFile(
        join(directory, "Pulumi.yaml"),
        `name: ${project}\nruntime: nodejs\n`,
      );
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ private: true, main: "index.cjs" }),
      );
      await writeFile(
        join(directory, "index.cjs"),
        `const pulumi = require(${JSON.stringify(sdk)});
const config = new pulumi.Config();
exports.marker = config.require("marker");
exports.secret = config.requireSecret("fixtureSecret");
exports.inheritedCredentials = Object.keys(process.env).filter(k => /^(AWS_|CLOUDFLARE_|GITHUB_TOKEN$|GH_TOKEN$)/.test(k));
`,
      );
    }
    const sourceStack = "organization/savia-cloudflare/preview",
      targetStack = "organization/savia-management/management";
    const init = (cwd, stack) =>
      command("initialize local stack", cwd, [
        "stack",
        "init",
        stack,
        "--secrets-provider",
        "passphrase",
        "--non-interactive",
      ]);
    const exportState = async (cwd, stack) =>
      JSON.parse(
        await command("export local checkpoint", cwd, [
          "stack",
          "export",
          "--stack",
          stack,
        ]),
      );
    await init(source, sourceStack);
    await init(destination, targetStack);
    assert.deepEqual(
      settledCheckpoint(await exportState(source, sourceStack)),
      [],
    );
    assert.deepEqual(
      settledCheckpoint(await exportState(destination, targetStack)),
      [],
    );
    const set = (key, value, secret = false) =>
      command("configure local fixture", source, [
        "config",
        "set",
        key,
        value,
        ...(secret ? ["--secret"] : []),
        "--stack",
        sourceStack,
        "--non-interactive",
      ]);
    const canary = `fixture-only-${randomBytes(16).toString("hex")}`;
    await set("marker", "last-applied");
    await set("fixtureSecret", canary, true);
    const saved = join(root, "fixture.plan.json");
    const plan = normalizeEnvironmentPlan(
      JSON.parse(
        await command("preview local fixture", source, [
          "preview",
          "--stack",
          sourceStack,
          "--save-plan",
          saved,
          "--json",
          "--non-interactive",
        ]),
      ),
    );
    assertBookkeepingPlan(plan);
    assert.ok(plan.steps.every((row) => row.type === "pulumi:pulumi:Stack"));
    await command("apply root-only local fixture", source, [
      "up",
      "--stack",
      sourceStack,
      "--plan",
      saved,
      "--skip-preview",
      "--yes",
      "--non-interactive",
    ]);
    const state = await exportState(source, sourceStack);
    assert.deepEqual(
      settledCheckpoint(state).find((row) => row.type === "pulumi:pulumi:Stack")
        .outputs.inheritedCredentials,
      [],
    );
    await set("marker", "desired-source-config");
    const snapshot = join(root, "snapshot.private.yaml");
    await command("recover applied configuration", source, [
      "config",
      "refresh",
      "--force",
      "--stack",
      sourceStack,
      "--config-file",
      snapshot,
      "--non-interactive",
    ]);
    const applied = JSON.parse(
      await command("read public applied configuration", source, [
        "config",
        "--json",
        "--stack",
        sourceStack,
        "--config-file",
        snapshot,
      ]),
    );
    assert.equal(applied["savia-cloudflare:marker"].value, "last-applied");
    assert.equal(applied["savia-cloudflare:fixtureSecret"].secret, true);
    assert.equal(JSON.stringify(applied).includes(canary), false);
    assert.equal(
      (
        await command("check desired configuration", source, [
          "config",
          "get",
          "marker",
          "--stack",
          sourceStack,
        ])
      ).trim(),
      "desired-source-config",
    );

    // A synthetic provider and bucket are checkpoint fixtures only. No Cloudflare
    // provider is installed or executed, and no program declares this bucket.
    const accountId = "a".repeat(32),
      name = "savia-pulumi-state-preview";
    const providerUrn =
      "urn:pulumi:preview::savia-cloudflare::pulumi:providers:cloudflare::fixture";
    const bucket = {
      urn: "urn:pulumi:preview::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::state-backend",
      type: "cloudflare:index/r2Bucket:R2Bucket",
      custom: true,
      id: `${accountId}/${name}/default`,
      protect: true,
      provider: `${providerUrn}::fixture-provider`,
      inputs: { accountId, name },
      outputs: { accountId, name },
    };
    state.deployment.resources.push(
      {
        urn: providerUrn,
        type: "pulumi:providers:cloudflare",
        custom: true,
        id: "fixture-provider",
        inputs: {},
        outputs: {},
      },
      bucket,
    );
    const input = join(root, "checkpoint.private.json");
    await writeFile(input, JSON.stringify(state), { mode: 0o600 });
    await command("import synthetic local checkpoint", source, [
      "stack",
      "import",
      "--stack",
      sourceStack,
      "--file",
      input,
      "--non-interactive",
    ]);
    await command("move protected local fixture", source, [
      "state",
      "move",
      "--source",
      sourceStack,
      "--dest",
      targetStack,
      bucket.urn,
      "--yes",
      "--non-interactive",
    ]);
    const remaining = settledCheckpoint(await exportState(source, sourceStack)),
      moved = settledCheckpoint(await exportState(destination, targetStack));
    assert.equal(
      remaining.some((row) => row.type === bucket.type),
      false,
    );
    const targets = moved.filter((row) => row.type === bucket.type);
    assert.equal(targets.length, 1);
    for (const key of ["id", "inputs", "outputs", "protect"])
      assert.deepEqual(targets[0][key], bucket[key]);
    return {
      status: "passed",
      cliVersion: version,
      sdkVersion,
      backend: "temporary-file",
      checks: {
        emptyCheckpoint: true,
        bookkeepingPlan: true,
        appliedConfiguration: true,
        secretRedaction: true,
        protectedStateMove: true,
        cloudCredentialsExcluded: true,
      },
      cleaned: true,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCliPreflight()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
