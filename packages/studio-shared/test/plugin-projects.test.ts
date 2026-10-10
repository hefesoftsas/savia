import { describe, expect, it } from "vitest";
import {
  PLUGIN_PROJECT_MAX_BYTES,
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
