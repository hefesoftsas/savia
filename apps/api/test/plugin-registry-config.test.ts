import { describe, expect, it } from "vitest";
import {
  pluginRegistryForTenant,
  runtimePluginRegistryForTenant,
} from "../src/studio/plugin-registry-config";

describe("plugin registry tenant configuration", () => {
  const config = JSON.stringify({
    "tenant:1": {
      url: "https://registry.example",
      token: "a".repeat(32),
      publishToken: "p".repeat(32),
    },
    "tenant:2": { url: "https://registry.example", token: "b".repeat(32) },
  });
  it("selects only the exact tenant and keeps unconfigured tenants disconnected", () => {
    expect(pluginRegistryForTenant(config, "tenant:1")?.token).toBe(
      "a".repeat(32),
    );
    expect(pluginRegistryForTenant(config, "tenant:1")?.publishToken).toBe(
      "p".repeat(32),
    );
    expect(pluginRegistryForTenant(config, "tenant:2")?.token).toBe(
      "b".repeat(32),
    );
    expect(pluginRegistryForTenant(config, "tenant:3")).toBeUndefined();
    expect(pluginRegistryForTenant(undefined, "tenant:1")).toBeUndefined();
    expect(pluginRegistryForTenant(config, "1")).toBeUndefined();
  });
  it.each([
    "{",
    "[]",
    "null",
    JSON.stringify({
      "*": { url: "https://registry.example", token: "x".repeat(32) },
    }),
    JSON.stringify({
      "tenant:1": { url: "http://registry.example", token: "x".repeat(32) },
    }),
    JSON.stringify({
      "tenant:1": {
        url: "https://secret@registry.example",
        token: "x".repeat(32),
      },
    }),
    JSON.stringify({
      "tenant:1": {
        url: "https://registry.example/path",
        token: "x".repeat(32),
      },
    }),
    JSON.stringify({
      "tenant:1": { url: "https://registry.example", token: "short" },
    }),
  ])("fails closed with a sanitized configuration error", (raw) => {
    expect(() => pluginRegistryForTenant(raw, "tenant:1")).toThrow(
      "Invalid PLUGIN_REGISTRY_TENANTS configuration",
    );
  });
  it("permits HTTP loopback for local registry tests", () => {
    const raw = JSON.stringify({
      "tenant:1": { url: "http://127.0.0.1:8798", token: "x".repeat(32) },
    });
    expect(pluginRegistryForTenant(raw, "tenant:1")?.url).toBe(
      "http://127.0.0.1:8798",
    );
  });
  it("keeps publishing disabled unless a separate publish token is configured", () => {
    const raw = JSON.stringify({
      "tenant:1": { url: "https://registry.example", token: "r".repeat(32) },
    });
    expect(pluginRegistryForTenant(raw, "tenant:1")).toEqual({
      url: "https://registry.example",
      token: "r".repeat(32),
    });
  });
});

it("keeps invalid registry configuration isolated from the local runtime", () => {
  expect(() =>
    runtimePluginRegistryForTenant("invalid", "tenant:1"),
  ).not.toThrow();
  expect(runtimePluginRegistryForTenant("invalid", "tenant:1")).toEqual({
    url: "invalid:registry",
    token: "unavailable",
  });
});
