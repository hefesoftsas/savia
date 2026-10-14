import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile } from "./use-mobile";

function FirstFrame() {
  return <p>{useIsMobile() ? "mobile" : "desktop"}</p>;
}

afterEach(() => vi.unstubAllGlobals());

describe("responsive first frame", () => {
  it("uses the mobile layout before effects run in a narrow browser", () => {
    vi.stubGlobal("window", {
      innerWidth: 390,
      matchMedia: () => ({ matches: true }),
    });
    expect(renderToStaticMarkup(<FirstFrame />)).toBe("<p>mobile</p>");
  });

  it("keeps the desktop layout in a wide browser", () => {
    vi.stubGlobal("window", {
      innerWidth: 1280,
      matchMedia: () => ({ matches: false }),
    });
    expect(renderToStaticMarkup(<FirstFrame />)).toBe("<p>desktop</p>");
  });

  it("can render without a browser", () => {
    vi.stubGlobal("window", undefined);
    expect(renderToStaticMarkup(<FirstFrame />)).toBe("<p>desktop</p>");
  });
});
