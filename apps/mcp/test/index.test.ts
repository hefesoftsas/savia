import { describe, expect, it } from "vitest";
import { readHttpMcpConfiguration } from "../src/index";

describe("HTTP MCP configuration", () => {
  it("requires a private API URL and shared secret", () => {
    expect(() => readHttpMcpConfiguration({})).toThrow(
      "SAVIA_API_URL is required",
    );
    expect(() =>
      readHttpMcpConfiguration({ SAVIA_API_URL: "http://api:8787" }),
    ).toThrow("SAVIA_MCP_SHARED_SECRET is required");
  });

  it("uses the container-safe host and validates the port", () => {
    expect(
      readHttpMcpConfiguration({
        SAVIA_API_URL: "http://api:8787",
        SAVIA_MCP_SHARED_SECRET: "private-network-secret",
        MCP_HOST: "0.0.0.0",
        MCP_PORT: "8789",
      }),
    ).toEqual({
      apiUrl: "http://api:8787",
      host: "0.0.0.0",
      port: 8789,
      sharedSecret: "private-network-secret",
    });
    expect(() =>
      readHttpMcpConfiguration({
        SAVIA_API_URL: "http://api:8787",
        SAVIA_MCP_SHARED_SECRET: "private-network-secret",
        MCP_PORT: "0",
      }),
    ).toThrow("MCP_PORT must be an integer between 1 and 65535");
  });
});
