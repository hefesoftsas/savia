import { describe, expect, it } from "vitest";
import { requiredRecordingScope } from "../src/auth/recording-scope-policy";
import { requireOAuthScope } from "../src/auth/oauth-resource";
import { AuthenticationError } from "../src/auth/types";

describe("Companion OAuth recording scopes", () => {
  it.each([
    ["GET", "/v1/companion/recordings", "recordings:read"],
    [
      "GET",
      "/v1/companion/recordings/123e4567-e89b-42d3-a456-426614174000/notes",
      "recordings:read",
    ],
    ["POST", "/v1/companion/recordings", "recordings:upload"],
    ["POST", "/v1/companion/recordings/upload", "recordings:upload"],
    [
      "POST",
      "/v1/companion/recordings/123e4567-e89b-42d3-a456-426614174000/notes",
      "recordings:process",
    ],
    [
      "POST",
      "/v1/companion/recordings/123e4567-e89b-42d3-a456-426614174000/questions",
      "recordings:process",
    ],
  ])("maps %s %s to %s", (method, path, scope) => {
    expect(
      requiredRecordingScope(
        new Request(`https://api.savia.test${path}`, { method }),
      ),
    ).toBe(scope);
  });

  it.each([
    ["POST", "/v1/companion/recordings/import"],
    ["DELETE", "/v1/companion/recordings/123e4567-e89b-42d3-a456-426614174000"],
    ["POST", "/v1/identity/oauth-clients"],
  ])("does not classify %s %s as recording-scoped", (method, path) => {
    expect(
      requiredRecordingScope(
        new Request(`https://api.savia.test${path}`, { method }),
      ),
    ).toBeNull();
  });

  it("preserves the existing broad write scope for recording uploads", () => {
    const request = new Request(
      "https://api.savia.test/v1/companion/recordings/upload",
      { method: "POST" },
    );
    expect(() =>
      requireOAuthScope(
        { scopes: new Set(["savia.api.write"]) } as never,
        request,
      ),
    ).not.toThrow();
  });

  it("keeps narrow recording grants operation-specific", () => {
    const request = new Request(
      "https://api.savia.test/v1/companion/recordings/upload",
      { method: "POST" },
    );
    expect(() =>
      requireOAuthScope(
        { scopes: new Set(["recordings:read"]) } as never,
        request,
      ),
    ).toThrowError(AuthenticationError);
  });

  it("requires recordings:read for Companion session discovery", () => {
    const request = new Request("https://api.savia.test/v1/companion/session");
    expect(() =>
      requireOAuthScope(
        { scopes: new Set(["savia.api.read"]) } as never,
        request,
      ),
    ).toThrowError(AuthenticationError);
  });
});
