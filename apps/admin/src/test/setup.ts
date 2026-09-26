import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { invalidateSharedDataDomains } from "@/api/domain-client";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as typeof ResizeObserver;

// cmdk/radix popovers call scrollIntoView when opening; jsdom does not
// implement it and the app error boundary would swallow the view instead.
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollIntoView !== "function"
) {
  Element.prototype.scrollIntoView = () => undefined;
}

if (typeof window !== "undefined")
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

afterEach(() => {
  invalidateSharedDataDomains();
});
