import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
  const expectedBridge = createHmac("sha256", values.SAVIA_MCP_SHARED_SECRET)
    .update("savia:auth-tenant-user-administration:v1")
    .digest("hex");
  assert.equal(
    plans.find((x) => x.app === "auth").secrets.SAVIA_INTERNAL_BRIDGE_KEY,
    expectedBridge,
  );
  assert.equal(apiSecrets.SAVIA_INTERNAL_BRIDGE_KEY, expectedBridge);
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

test("OAuth credentials are optional complete pairs for the auth Worker", () => {
  const authSecrets = buildSecretUploads("preview", values).find(
    (plan) => plan.app === "auth",
  ).secrets;
  assert.equal("SAVIA_GOOGLE_CLIENT_ID" in authSecrets, false);
  assert.equal("SAVIA_GOOGLE_CLIENT_SECRET" in authSecrets, false);
  assert.equal("SAVIA_MICROSOFT_CLIENT_ID" in authSecrets, false);
  assert.equal("SAVIA_MICROSOFT_CLIENT_SECRET" in authSecrets, false);

  const oauth = {
    SAVIA_GOOGLE_CLIENT_ID: "google-client-id",
    SAVIA_GOOGLE_CLIENT_SECRET: "google-client-secret",
    SAVIA_MICROSOFT_CLIENT_ID: "microsoft-client-id",
    SAVIA_MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
  };
  const enabledAuthSecrets = buildSecretUploads("production", {
    ...values,
    ...oauth,
  }).find((plan) => plan.app === "auth").secrets;
  for (const [key, value] of Object.entries(oauth))
    assert.equal(enabledAuthSecrets[key], value);

  for (const key of Object.keys(oauth)) {
    assert.throws(
      () => buildSecretUploads("preview", { ...values, [key]: oauth[key] }),
      /SAVIA_(GOOGLE|MICROSOFT)_CLIENT_(ID|SECRET).*configured together/,
    );
  }
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

test("ChatGPT website clients require the registered authentication method", () => {
  const publicClient = buildSecretUploads("preview", {
    ...values,
    SAVIA_CHATGPT_CLIENT_ID: "oaiapp_test",
  }).find((plan) => plan.app === "auth").secrets;
  assert.equal(publicClient.SAVIA_CHATGPT_CLIENT_ID, "oaiapp_test");
  assert.equal(publicClient.SAVIA_CHATGPT_TOKEN_AUTH_METHOD, "none");
  assert.throws(
    () =>
      buildSecretUploads("preview", {
        ...values,
        SAVIA_CHATGPT_CLIENT_ID: "oaiapp_test",
        SAVIA_CHATGPT_CLIENT_SECRET: "test-secret",
      }),
    /ChatGPT/,
  );
  assert.throws(
    () =>
      buildSecretUploads("preview", {
        ...values,
        SAVIA_CHATGPT_CLIENT_ID: "dynamic_agent_client_test",
      }),
    /ChatGPT/,
  );
  const confidential = buildSecretUploads("preview", {
    ...values,
    SAVIA_CHATGPT_CLIENT_ID: "oaiapp_test",
    SAVIA_CHATGPT_CLIENT_SECRET: "test-secret",
    SAVIA_CHATGPT_TOKEN_AUTH_METHOD: "client_secret_basic",
  }).find((plan) => plan.app === "auth").secrets;
  assert.equal(confidential.SAVIA_CHATGPT_CLIENT_SECRET, "test-secret");
  assert.equal(
    confidential.SAVIA_CHATGPT_TOKEN_AUTH_METHOD,
    "client_secret_basic",
  );
});
