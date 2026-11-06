import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startCommand } from "./mcp-e2e-process.mjs";
import { fixtureConfig, isolateCompose } from "./mcp-e2e-fixture.mjs";

test("command output and failed exits are propagated", async () => {
  const task = startCommand(
    process.execPath,
    ["-e", "process.stdout.write('fixture')"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(await task.done, "fixture");
  const failed = startCommand(process.execPath, ["-e", "process.exit(7)"], {
    stdio: "ignore",
  });
  await assert.rejects(failed.done, /exited 7/);
});

test("private log capture retains stderr without mixing it into JSON capture", async () => {
  const args = [
    "-e",
    "process.stdout.write('{}');process.stderr.write('private fixture diagnostic')",
  ];
  const options = { stdio: ["ignore", "pipe", "pipe"] };
  assert.equal(await startCommand(process.execPath, args, options).done, "{}");
  const logs = await startCommand(process.execPath, args, {
    ...options,
    captureStderr: true,
  }).done;
  assert.ok(logs.includes("{}"));
  assert.ok(logs.includes("private fixture diagnostic"));
});

test(
  "cancellation stops a wrapper and its SIGTERM-resistant descendant",
  { timeout: 10000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "savia-e2e-process-"));
    const heartbeat = join(directory, "heartbeat");
    const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(process.argv[1],String(Date.now())),20);`;
    const wrapper = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)},process.argv[1]],{stdio:'inherit'});setInterval(()=>{},1000);`;
    const task = startCommand(process.execPath, ["-e", wrapper, heartbeat], {
      stdio: "ignore",
    });
    // A stopped process is expected to return a nonzero exit status.
    void task.done.catch(() => {});
    try {
      const deadline = Date.now() + 4000;
      while (true) {
        try {
          await readFile(heartbeat);
          break;
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await delay(20);
        }
      }
      await task.stop();
      const stopped = await readFile(heartbeat, "utf8");
      await delay(150);
      assert.equal(await readFile(heartbeat, "utf8"), stopped);
      await assert.rejects(task.done);
    } finally {
      await task.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("disposable fixtures isolate images, volumes and loopback ports", () => {
  const a = fixtureConfig("savia-mcp-e2e-abc", 18080, 18333);
  const b = fixtureConfig("savia-mcp-e2e-def", 28080, 28333);
  assert.notEqual(a.services.savia.image, b.services.savia.image);
  assert.deepEqual(a.services.savia.ports, ["127.0.0.1:18080:8080"]);
  assert.deepEqual(a.services.storage.ports, ["127.0.0.1:18333:8333"]);
  assert.equal(a.services.savia.image, a.services["storage-init"].image);
  assert.equal(a.services.savia.restart, "no");
});

test("refuses broad or existing project names and invalid ports", () => {
  for (const name of ["savia", "savia-self-hosted", "", "../savia"])
    assert.throws(() => fixtureConfig(name, 18080, 18333));
  for (const port of [0, -1, 65536, "8080"])
    assert.throws(() => fixtureConfig("savia-mcp-e2e-abc", port, 18333));
  assert.throws(() => fixtureConfig("savia-mcp-e2e-abc", 18080, 18080));
});

test("materialized Compose discards shared names and tolerates omitted profiles", () => {
  const base = {
    name: "savia-self-hosted",
    services: {
      savia: {},
      storage: {},
      "storage-init": {},
      "storage-config": {},
    },
    volumes: { database: { name: "savia-self-hosted_database" } },
    networks: { default: { name: "savia-self-hosted_default" } },
  };
  const isolated = isolateCompose(base, "savia-mcp-e2e-abc", 18080, 18333);
  assert.equal(isolated.name, "savia-mcp-e2e-abc");
  assert.deepEqual(isolated.volumes.database, {});
  assert.deepEqual(isolated.networks.default, {});
  assert.equal(base.volumes.database.name, "savia-self-hosted_database");
  assert.throws(() =>
    isolateCompose(
      { ...base, volumes: { database: { external: true } } },
      "savia-mcp-e2e-abc",
      18080,
      18333,
    ),
  );
});
