import { describe, expect, it, vi } from "vitest";
import { getScrollParent, syncScrollButtonPosition } from "../table-scroll";

describe("table-scroll utilities", () => {
  it("finds the nearest ancestor with overflow-y: auto", () => {
    const root = document.createElement("div");
    root.style.overflowY = "auto";
    const middle = document.createElement("div");
    const target = document.createElement("div");

    root.appendChild(middle);
    middle.appendChild(target);
    document.body.appendChild(root);

    expect(getScrollParent(target)).toBe(root);

    document.body.removeChild(root);
  });

  it("returns null when no scrolling parent exists", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.appendChild(child);
    document.body.appendChild(parent);

    expect(getScrollParent(child)).toBeNull();

    document.body.removeChild(parent);
  });

  it("calculates and sets --records-table-scroll-top centered within visible viewport", () => {
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 600,
      height: 600,
      width: 1000,
      left: 0,
      right: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const shell = document.createElement("div");
    // Simulate a tall table: top is at 100, bottom at 2100 (height 2000px)
    vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 2100,
      height: 2000,
      width: 1000,
      left: 0,
      right: 1000,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    container.appendChild(shell);
    document.body.appendChild(container);

    syncScrollButtonPosition(shell);

    // visibleTop = max(100, 0) = 100
    // visibleBottom = min(2100, 600) = 600
    // visibleMid = (100 + 600) / 2 = 350
    // topInShell = 350 - 100 = 250px
    const value = shell.style.getPropertyValue("--records-table-scroll-top");
    expect(value).toBe("250px");

    document.body.removeChild(container);
  });

  it("adjusts position when table is scrolled down through the container", () => {
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 600,
      height: 600,
      width: 1000,
      left: 0,
      right: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const shell = document.createElement("div");
    // Table is scrolled up: shell.top is -500, bottom is 1500 (height 2000px)
    vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
      top: -500,
      bottom: 1500,
      height: 2000,
      width: 1000,
      left: 0,
      right: 1000,
      x: 0,
      y: -500,
      toJSON: () => ({}),
    });

    container.appendChild(shell);
    document.body.appendChild(container);

    syncScrollButtonPosition(shell);

    // visibleTop = max(-500, 0) = 0
    // visibleBottom = min(1500, 600) = 600
    // visibleMid = (0 + 600) / 2 = 300
    // topInShell = 300 - (-500) = 800px
    const value = shell.style.getPropertyValue("--records-table-scroll-top");
    expect(value).toBe("800px");

    document.body.removeChild(container);
  });

  it("safely handles elements with 0 height", () => {
    const shell = document.createElement("div");
    vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 0,
      height: 0,
      width: 0,
      left: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    syncScrollButtonPosition(shell);
    expect(shell.style.getPropertyValue("--records-table-scroll-top")).toBe("");
  });
});
