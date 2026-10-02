// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { resolveConfig } from "vite";
import { expect, it, vi } from "vitest";

it("activates the generated replacement worker without waiting for old tabs to close", async () => {
  const output = await mkdtemp(join(tmpdir(), "savia-worker-lifecycle-"));
  try {
    await writeFile(join(output, "index.html"), "<html>Savia</html>");
    const config = await resolveConfig(
      { build: { outDir: output }, logLevel: "silent" },
      "build",
    );
    const pwa = config.plugins.find(
      (plugin) => plugin.name === "vite-plugin-pwa",
    );
    expect(pwa).toBeDefined();
    await pwa!.api.generateSW();

    const skipWaiting = vi.fn();
    const clientsClaim = vi.fn();
    // Execute the emitted worker, rather than checking the requested plugin
    // options: autoUpdate alone is ignored when injectRegister is false.
    runInNewContext(await readFile(join(output, "sw.js"), "utf8"), {
      self: { skipWaiting, addEventListener: vi.fn() },
      define: (
        _dependencies: string[],
        initialize: (workbox: object) => void,
      ) =>
        initialize({
          clientsClaim,
          precacheAndRoute: vi.fn(),
          cleanupOutdatedCaches: vi.fn(),
          registerRoute: vi.fn(),
          createHandlerBoundToURL: vi.fn(),
          NavigationRoute: class {},
          CacheFirst: class {},
          ExpirationPlugin: class {},
          CacheableResponsePlugin: class {},
        }),
    });
    expect(skipWaiting).toHaveBeenCalledOnce();
    expect(clientsClaim).toHaveBeenCalledOnce();
    expect(pwa!.api.registerSWData()).toBeUndefined();
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}, 30_000);
