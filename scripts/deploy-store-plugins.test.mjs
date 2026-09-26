import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deploymentTargets,
  deployStorePlugins,
} from "./deploy-store-plugins.mjs";

test("targets require explicit workspace selection", () => {
  assert.deepEqual(deploymentTargets(""), []);
  for (const value of [
    "{}",
    "[{}]",
    '[{"tenant":"a","domain":"b"}]',
    '[{"tenant":"a","ports":[]}]',
  ])
    assert.throws(() => deploymentTargets(value));
});

test("deployment signs in, updates only enabled plugins, and revokes its session", async () => {
  const calls = [];
  const env = {
    SAVIA_API_URL: "https://savia.test",
    SAVIA_PLUGIN_TARGETS: '[{"tenant":"agency:1","ports":["http-echo"]}]',
    SAVIA_DEPLOY_EMAIL: "automation@test",
    SAVIA_DEPLOY_PASSWORD: "secret",
  };
  const io = {
    log() {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", {
        headers: { "set-cookie": "session=private; HttpOnly" },
      });
    },
    publish: async (options) => {
      assert.equal(options.updateInstalled, true);
      assert.equal(options.cookie, "session=private");
      assert.deepEqual(options.ports, ["http-echo"]);
      return [{ error: "test failure" }];
    },
  };
  await assert.rejects(deployStorePlugins(env, io), /Plugin deployment failed/);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith("/sign-out"));
  assert.equal(calls[1].init.headers.cookie, "session=private");
});

test("unconfigured deployment makes no requests; incomplete configured deployment fails", async () => {
  assert.deepEqual(
    await deployStorePlugins(
      {},
      {
        log() {},
        fetch() {
          throw new Error("unexpected request");
        },
      },
    ),
    [],
  );
  await assert.rejects(
    deployStorePlugins({
      SAVIA_API_URL: "https://savia.test",
      SAVIA_PLUGIN_TARGETS: '[{"tenant":"a"}]',
    }),
    /require SAVIA_DEPLOY_EMAIL/,
  );
});
