import assert from "node:assert/strict";
import test from "node:test";
import { buildSecretUploads } from "./upload-cloudflare-secrets.mjs";
const values = Object.fromEntries(
  [
    "BETTER_AUTH_SECRET",
    "SAVIA_MCP_SHARED_SECRET",
    "SAVIA_REQUEST_ENCRYPTION_KEY",
    "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
    "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
    "CRM_INTEGRATION_KEY",
    "NANGO_API_KEY",
  ].map((key) => [key, "test-only-value"]),
);
test("preview secrets always use explicit preview configuration and names", () => {
  const plans = buildSecretUploads("preview", values);
  assert.equal(plans.length, 5);
  for (const plan of plans) {
    assert.ok(plan.worker.endsWith("-preview"));
    assert.equal(plan.config, "wrangler.preview.jsonc");
  }
  assert.equal(
    plans.find((x) => x.app === "savia-request").secrets.ENCRYPTION_KEY,
    values.SAVIA_REQUEST_ENCRYPTION_KEY,
  );
  const apiSecrets = plans.find((x) => x.app === "api").secrets;
  assert.equal(apiSecrets.STUDIO_INTEGRATION_KEY, "test-only-value");
  assert.ok(!("CRM_INTEGRATION_KEY" in apiSecrets));
  assert.throws(() => buildSecretUploads("other", values), /environment/);
  assert.throws(() => buildSecretUploads("preview", {}), /required/);
});

test("studio integration key prefers the canonical name over the legacy alias", () => {
  const canonical = buildSecretUploads("preview", {
    ...Object.fromEntries(
      [
        "BETTER_AUTH_SECRET",
        "SAVIA_MCP_SHARED_SECRET",
        "SAVIA_REQUEST_ENCRYPTION_KEY",
        "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
        "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
        "NANGO_API_KEY",
      ].map((key) => [key, "test-only-value"]),
    ),
    STUDIO_INTEGRATION_KEY: "canonical-value",
    CRM_INTEGRATION_KEY: "legacy-value",
  }).find((x) => x.app === "api").secrets;
  assert.equal(canonical.STUDIO_INTEGRATION_KEY, "canonical-value");
});

test("database bridge requires a complete HTTPS configuration", () => {
  for (const environment of ["preview", "production"]) {
    const bridge = {
      SQL_BRIDGE_URL: "https://bridge.example.com",
      SQL_BRIDGE_SECRET: "test-bridge-secret",
    };
    const api = buildSecretUploads(environment, { ...values, ...bridge }).find(
      (plan) => plan.app === "api",
    );
    assert.equal(api.secrets.SQL_BRIDGE_URL, bridge.SQL_BRIDGE_URL);
    assert.equal(api.secrets.SQL_BRIDGE_SECRET, bridge.SQL_BRIDGE_SECRET);
    assert.throws(
      () =>
        buildSecretUploads(environment, {
          ...values,
          SQL_BRIDGE_URL: bridge.SQL_BRIDGE_URL,
        }),
      /SQL_BRIDGE/,
    );
    assert.throws(
      () =>
        buildSecretUploads(environment, {
          ...values,
          SQL_BRIDGE_SECRET: bridge.SQL_BRIDGE_SECRET,
        }),
      /SQL_BRIDGE/,
    );
    assert.throws(
      () =>
        buildSecretUploads(environment, {
          ...values,
          ...bridge,
          SQL_BRIDGE_URL: "http://bridge.example.com",
        }),
      /HTTPS/,
    );
  }
});
