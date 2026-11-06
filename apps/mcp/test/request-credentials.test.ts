import { describe, expect, it } from "vitest";
import {
  McpRequestCredentialError,
  readDelegatedRequestCredentials,
} from "../src/request-credentials";

describe("delegated MCP request credentials", () => {
  it("accepts the internal secret and the current user's bearer token", () => {
    expect(
      readDelegatedRequestCredentials(
        new Headers({
          "x-savia-mcp-secret": "internal-secret",
          "x-savia-user-authorization": "Bearer user-session-token",
        }),
        "internal-secret",
      ),
    ).toEqual({ authorization: "Bearer user-session-token" });
  });

  it.each([
    new Headers({ "x-savia-user-authorization": "Bearer user-session-token" }),
    new Headers({ "x-savia-mcp-secret": "wrong-secret" }),
    new Headers({ "x-savia-mcp-secret": "internal-secret" }),
    new Headers({
      "x-savia-mcp-secret": "internal-secret",
      "x-savia-user-authorization": "user-session-token",
    }),
  ])("rejects missing or invalid credentials", (headers) => {
    expect(() =>
      readDelegatedRequestCredentials(headers, "internal-secret"),
    ).toThrow(McpRequestCredentialError);
  });
});
