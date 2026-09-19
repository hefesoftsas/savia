import { describe, expect, it } from "vitest";
import { isOfflineError } from "./offline-error";

describe("isOfflineError", () => {
  it("detects browser network failures", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new TypeError("Load failed"))).toBe(true);
    expect(isOfflineError(new Error("Network request failed"))).toBe(true);
    expect(
      isOfflineError(new Error("NetworkError when attempting to fetch")),
    ).toBe(true);
  });

  it("detects unavailable backends and server crashes", () => {
    expect(
      isOfflineError({ code: "AUTHENTICATION_UNAVAILABLE", status: 503 }),
    ).toBe(true);
    expect(isOfflineError({ code: "HTTP_500", status: 500 })).toBe(true);
  });

  it("rejects real authorization and validation answers", () => {
    expect(
      isOfflineError({ code: "AUTHORIZATION_FORBIDDEN", status: 403 }),
    ).toBe(false);
    expect(isOfflineError({ code: "VALIDATION_ERROR", status: 400 })).toBe(
      false,
    );
    expect(isOfflineError({ code: "LAST_ACTIVE_MEMBER", status: 409 })).toBe(
      false,
    );
    expect(isOfflineError({ code: "NOT_FOUND", status: 404 })).toBe(false);
    expect(
      isOfflineError(new Error("No fue posible eliminar el usuario.")),
    ).toBe(false);
    expect(isOfflineError(undefined)).toBe(false);
    expect(isOfflineError(null)).toBe(false);
  });
});
