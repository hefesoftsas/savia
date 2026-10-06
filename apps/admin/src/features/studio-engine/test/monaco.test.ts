// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveMonacoTheme } from "../monaco";

describe("monaco loader", () => {
  it("maps document theme to monaco themes", () => {
    document.documentElement.classList.remove("dark");
    expect(resolveMonacoTheme()).toBe("vs");
    document.documentElement.classList.add("dark");
    expect(resolveMonacoTheme()).toBe("vs-dark");
  });
});
