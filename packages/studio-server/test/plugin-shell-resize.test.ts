import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { shellBootstrapJs } from "../src/plugin-store";

it("reports natural content growth and shrinkage without a viewport feedback loop", () => {
  let height = 400;
  let onResize: (() => void) | undefined;
  const frames: Array<() => void> = [];
  const root = {
    get scrollHeight() {
      return height;
    },
    getBoundingClientRect: () => ({ height }),
  };
  const postMessage = vi.fn();
  const observe = vi.fn();
  // Execute the real bootstrap's sizing setup without starting the API bridge
  // or loading a plugin module. DOM measurements are supplied by the browser.
  const setup = shellBootstrapJs()
    .split("function requestHost")[0]
    .replaceAll(
      "import.meta.url",
      JSON.stringify(
        "http://localhost/api/plugin-store/shell-bootstrap.js?plugin=demo&screen=demo&entry=/api/plugin-store/demo/entry",
      ),
    );
  runInNewContext(setup, {
    URL,
    document: { getElementById: () => root },
    parent: { postMessage },
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    addEventListener: () => undefined,
    ResizeObserver: class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = observe;
    },
  });
  expect(observe).toHaveBeenCalledWith(root);
  frames.shift()!();
  expect(postMessage).toHaveBeenLastCalledWith(
    { ns: "savia-plugin", type: "resize", height: 400 },
    "*",
  );
  height = 1800;
  onResize!();
  onResize!();
  expect(frames).toHaveLength(1);
  frames.shift()!();
  expect(postMessage).toHaveBeenLastCalledWith(
    { ns: "savia-plugin", type: "resize", height: 1800 },
    "*",
  );
  height = 250;
  onResize!();
  frames.shift()!();
  expect(postMessage).toHaveBeenLastCalledWith(
    { ns: "savia-plugin", type: "resize", height: 250 },
    "*",
  );
  onResize!();
  frames.shift()!();
  expect(postMessage).toHaveBeenCalledTimes(3);
});
