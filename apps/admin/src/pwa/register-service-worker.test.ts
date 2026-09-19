// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { registerPwaServiceWorker } from "./register-service-worker";

afterEach(() => vi.restoreAllMocks());
it("registers after lazy private bootstrap even when window load already fired", async () => {
  const register = vi.fn().mockResolvedValue({ scope: "/" });
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  registerPwaServiceWorker();
  expect(register).toHaveBeenCalledOnce();
});
it("waits for load while the private page is still loading", () => {
  const register = vi.fn().mockResolvedValue({ scope: "/" });
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  registerPwaServiceWorker();
  expect(register).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("load"));
  window.dispatchEvent(new Event("load"));
  expect(register).toHaveBeenCalledOnce();
});
