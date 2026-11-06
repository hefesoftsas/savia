import { describe, expect, it } from "vitest";
import { deleteUserErrorMessage } from "./user-pages";

describe("deleteUserErrorMessage", () => {
  it("explains the last active member guard", () => {
    expect(
      deleteUserErrorMessage({ code: "LAST_ACTIVE_MEMBER", status: 409 }),
    ).toContain("al menos un usuario activo");
  });

  it("explains self-delete and last admin guards", () => {
    expect(
      deleteUserErrorMessage({ code: "AUTHORIZATION_FORBIDDEN", status: 403 }),
    ).toContain("a ti mismo");
    expect(
      deleteUserErrorMessage({ code: "VALIDATION_ERROR", status: 400 }),
    ).toContain("último administrador");
  });

  it("maps missing users and offline failures", () => {
    expect(
      deleteUserErrorMessage({ code: "NOT_FOUND", status: 404 }),
    ).toContain("ya no existe");
    expect(
      deleteUserErrorMessage({
        code: "AUTHENTICATION_UNAVAILABLE",
        status: 503,
      }),
    ).toContain("Sin conexión");
    expect(deleteUserErrorMessage(new Error("Failed to fetch"))).toContain(
      "Sin conexión",
    );
  });

  it("falls back to a generic message", () => {
    expect(deleteUserErrorMessage({ code: "HTTP_500", status: 500 })).toContain(
      "Sin conexión",
    );
    expect(deleteUserErrorMessage({ code: "UNKNOWN" })).toBe(
      "No fue posible eliminar el usuario.",
    );
  });
});
