import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LottiePreview } from "./lottie-preview";
import { I18nContextProvider } from "ra-core";
const data = { v: "5.7.0", fr: 30, ip: 0, op: 60, layers: [] };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as Window & { lottie?: unknown }).lottie;
});
it("pauses previews in hidden tabs, honors reduced motion and destroys the player on unmount", async () => {
  const events: Record<string, () => void> = {};
  let reduced = false;
  const preference = {
    get matches() {
      return reduced;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(
    preference as unknown as MediaQueryList,
  );
  const player = {
    totalFrames: 60,
    addEventListener: (name: string, callback: () => void) => {
      events[name] = callback;
    },
    goToAndStop: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
  };
  (window as Window & { lottie?: unknown }).lottie = {
    loadAnimation: vi.fn(() => player),
  };
  const mounted = render(
    <I18nContextProvider
      value={{
        translate: (key: string) => key,
        changeLocale: async () => {},
        getLocale: () => "es",
      }}
    >
      <LottiePreview data={data} name="Star" />
    </I18nContextProvider>,
  );
  await act(async () => {});
  act(() => events.DOMLoaded());
  expect(player.play).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(player.pause).toHaveBeenCalledTimes(1);
  reduced = true;
  act(() => preference.addEventListener.mock.calls[0][1]());
  expect(player.goToAndStop).toHaveBeenCalledWith(59, true);
  mounted.unmount();
  expect(player.destroy).toHaveBeenCalledTimes(1);
  expect(preference.removeEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
});
