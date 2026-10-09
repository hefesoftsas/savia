import { expect, it, vi } from "vitest";
import { getSessionGeneration, rotateSessionScope } from "./session-scope";

it("keeps the scope when the same principal profile changes", () => {
  const before = getSessionGeneration();
  window.dispatchEvent(new Event("savia:identity-changed"));
  window.dispatchEvent(new Event("savia:account-changed"));
  expect(getSessionGeneration()).toBe(before);
});

it("rotates before notifying principal replacement consumers", () => {
  const before = getSessionGeneration();
  const seen = vi.fn(() => getSessionGeneration());
  window.addEventListener("savia:principal-changed", seen);
  try {
    rotateSessionScope("principal-change");
    expect(seen).toHaveReturnedWith(before + 1);
  } finally {
    window.removeEventListener("savia:principal-changed", seen);
  }
});

it("invalidates outstanding scope generations on logout", () => {
  const requestGeneration = getSessionGeneration();
  rotateSessionScope("logout");
  expect(getSessionGeneration()).not.toBe(requestGeneration);
});
