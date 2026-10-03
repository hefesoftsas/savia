import { describe, expect, it } from "vitest";
import { requiredRecordingScope } from "../src/auth/recording-scope-policy";
import { authorizePersonalApiKeyRequest } from "../src/auth/personal-api-key-policy";
import type { RecordingScope } from "../src/auth/personal-api-keys";

const base = "/v1/companion/sessions";
const id = "123e4567-e89b-42d3-a456-426614174000";
describe("long recording scope isolation", () => {
  it.each([
    ["GET", base, "recordings:read"],
    ["GET", `${base}/${id}`, "recordings:read"],
    ["GET", `${base}/${id}/chunks/microphone/0`, "recordings:read"],
    ["POST", base, "recordings:upload"],
    ["POST", `${base}/${id}/chunks`, "recordings:upload"],
    ["POST", `${base}/${id}/finalize`, "recordings:upload"],
    ["POST", `${base}/${id}/notes`, "recordings:process"],
    ["POST", `${base}/${id}/cancel`, "recordings:process"],
    ["POST", `${base}/${id}/questions`, "recordings:process"],
  ])("authorizes only the scope for %s %s", (method, path, scope) => {
    const request = new Request(`https://savia.test${path}`, { method });
    expect(requiredRecordingScope(request)).toBe(scope);
    expect(() =>
      authorizePersonalApiKeyRequest(request, [scope as RecordingScope]),
    ).not.toThrow();
    for (const other of [
      "recordings:read",
      "recordings:upload",
      "recordings:process",
    ] as const) {
      if (other !== scope)
        expect(() =>
          authorizePersonalApiKeyRequest(request, [other]),
        ).toThrow();
    }
  });
  it.each([
    ["GET", `${base}/${id}/chunks/system/-1`],
    ["GET", `${base}/${id}/chunks/upload/0`],
    ["POST", `${base}/${id}/chunks/system/0`],
    ["GET", `${base}/${id}/notes`],
    ["DELETE", `${base}/${id}`],
    ["POST", `${base}/../identity/users`],
  ])("rejects unrecognized %s %s", (method, path) => {
    const request = new Request(`https://savia.test${path}`, { method });
    expect(requiredRecordingScope(request)).toBeNull();
    expect(() =>
      authorizePersonalApiKeyRequest(request, [
        "recordings:read",
        "recordings:upload",
        "recordings:process",
      ]),
    ).toThrow();
  });
});
