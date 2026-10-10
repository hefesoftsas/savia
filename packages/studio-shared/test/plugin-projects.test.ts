import { describe, expect, it } from "vitest";
import {
  PLUGIN_PROJECT_MAX_BYTES,
  parsePluginOriginalSourceFiles,
  pluginOriginalSourceFilesSchema,
  pluginProjectFilesSchema,
  pluginProjectSaveSchema,
} from "../src/plugin-projects";

function files(entry: string) {
  return {
    "entry.tsx": entry,
    "savia-extension.json": "{}",
    "store.json": "{}",
    "preview.json": "{}",
  };
}

describe("plugin project file limits", () => {
  it("accepts a bounded original source archive in project files", () => {
    const originalSource = JSON.stringify({
      "packages/insurance-demo/src/admin.tsx": "export function Screen() {}",
      "packages/studio-shared/src/plugin-api.ts": "export type PluginApi = {};",
    });
    expect(() =>
      pluginProjectFilesSchema.parse({
        ...files("compiled entry"),
        "original-source.json": originalSource,
      }),
    ).not.toThrow();
    expect(parsePluginOriginalSourceFiles(originalSource)).toEqual({
      "packages/insurance-demo/src/admin.tsx": "export function Screen() {}",
      "packages/studio-shared/src/plugin-api.ts": "export type PluginApi = {};",
    });
  });

  it("retains bounded image assets required by original modules", () => {
    expect(
      parsePluginOriginalSourceFiles(
        JSON.stringify({
          "demo/brand.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
          "demo/brand.png": "data:image/png;base64,aW1hZ2U=",
          "demo/brand.webp": "data:image/webp;base64,aW1hZ2U=",
        }),
      ),
    ).toHaveProperty("demo/brand.svg");
  });

  it("rejects unsafe paths and unsupported files in original source", () => {
    for (const source of [
      { "../secret.ts": "x" },
      { "/etc/passwd.ts": "x" },
      { "packages\\demo\\src\\entry.tsx": "x" },
      { "packages/demo/src/constructor.ts": "x" },
      { "packages/demo/src/readme.md": "x" },
    ])
      expect(() => pluginOriginalSourceFilesSchema.parse(source)).toThrow();
  });

  it("bounds original source file count and UTF-8 bytes", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `packages/demo/src/${index}.ts`,
        "x",
      ]),
    );
    expect(() => pluginOriginalSourceFilesSchema.parse(tooMany)).toThrow();
    expect(() =>
      pluginOriginalSourceFilesSchema.parse({
        "packages/demo/src/large.ts": "😀".repeat(600_000),
      }),
    ).toThrow();
  });

  it("allows compiled entries above the normal 100 KB authoring file limit", () => {
    expect(() =>
      pluginProjectFilesSchema.parse(files("x".repeat(120 * 1024))),
    ).not.toThrow();
  });

  it("caps compiled entries at the plugin bundle limit", () => {
    expect(() =>
      pluginProjectFilesSchema.parse(files("x".repeat(2 * 1024 * 1024 + 1))),
    ).toThrow();
  });

  it("measures the compiled entry byte limit for multibyte text", () => {
    expect(() =>
      pluginProjectFilesSchema.parse(files("😀".repeat(600 * 1024))),
    ).toThrow();
  });

  it("keeps metadata files at 100 KB", () => {
    expect(() =>
      pluginProjectFilesSchema.parse({
        ...files("compiled entry"),
        "store.json": "x".repeat(100 * 1024 + 1),
      }),
    ).toThrow();
  });

  it("allows a JSON project larger than 512 KB within the shared project limit", () => {
    const request = {
      files: files("x".repeat(600 * 1024)),
      history: [],
      version: 0,
    };
    expect(() => pluginProjectSaveSchema.parse(request)).not.toThrow();
    expect(PLUGIN_PROJECT_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("rejects projects beyond the shared total byte limit", () => {
    const request = {
      files: files("\u0000".repeat(2 * 1024 * 1024)),
      history: [],
      version: 0,
    };
    expect(() => pluginProjectSaveSchema.parse(request)).toThrow();
  });
});
