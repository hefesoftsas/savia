// @vitest-environment node
import { build } from "vite";
import { expect, it } from "vitest";
import { saviaManualChunk } from "./manual-chunks";

it("keeps a dynamically imported editor out of the initial dependency closure", async () => {
  const modules: Record<string, string> = {
    "/fixture/entry.js":
      'import { value } from "light"; console.log(value); globalThis.openEditor = () => import("heavy").then(module => module.editor);',
    "/fixture/node_modules/light/index.js": 'export const value = "BOOT";',
    "/fixture/node_modules/heavy/index.js":
      'export const editor = "OPTIONAL_EDITOR_SENTINEL";',
  };
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "fixture",
        resolveId(id) {
          if (id === "light" || id === "heavy")
            return `/fixture/node_modules/${id}/index.js`;
          if (id in modules) return id;
        },
        load: (id) => modules[id],
      },
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: "/fixture/entry.js",
        output: { manualChunks: saviaManualChunk },
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((x) => x.output)
    .filter((x) => x.type === "chunk");
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    const chunk = chunks.find((x) => x.fileName === name)!;
    expect(chunk.code).not.toContain("OPTIONAL_EDITOR_SENTINEL");
    chunk.imports.forEach(visit);
  };
  chunks.filter((x) => x.isEntry).forEach((x) => visit(x.fileName));
  expect(chunks.some((x) => x.code.includes("OPTIONAL_EDITOR_SENTINEL"))).toBe(
    true,
  );
});
