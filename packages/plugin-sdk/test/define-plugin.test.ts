import { describe, expect, it, vi } from "vitest";
import { definePlugin } from "../src/index";

describe("definePlugin", () => {
  it("cleans the previous mount before reusing an element", () => {
    const calls: string[] = [];
    let mountCount = 0;
    const plugin = definePlugin({
      render(_element, _savia) {
        const mount = ++mountCount;
        calls.push(`mount:${mount}`);
        return () => calls.push(`cleanup:${mount}`);
      },
    });
    const element = document.createElement("div");
    const savia = {} as never;

    const first = plugin.render(element, savia);
    const second = plugin.render(element, savia);
    second();
    first();

    expect(calls).toEqual(["mount:1", "cleanup:1", "mount:2", "cleanup:2"]);
  });

  it("tracks panel mounts independently from normal mounts", () => {
    const cleanup = vi.fn();
    const plugin = definePlugin({
      render: () => undefined,
      renderPanel: (_element, _savia) => cleanup,
    });
    const panel = document.createElement("div");

    const unmount = plugin.renderPanel!(panel, {} as never);
    unmount();
    unmount();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
