import { describe, expect, it } from "vitest";
import {
  editorExtensionMetadataSchema,
  installedEditorExtensionSchema,
  projectEditorExtensionReferencesSchema,
} from "../src/plugin-editor-extensions";

const metadata = {
  id: "acme.browser-tools",
  publisher: "acme",
  name: "browser-tools",
  version: "1.2.3",
  sha256: "a".repeat(64),
  license: "MIT",
  compressedBytes: 512,
  expandedBytes: 1024,
  dependencies: [],
  compatibility: { supported: true, reason: null },
};

describe("editor extension metadata schemas", () => {
  it("accepts a complete immutable package metadata record", () => {
    expect(editorExtensionMetadataSchema.parse(metadata)).toEqual(metadata);
  });

  it("rejects invalid package identities and digests", () => {
    expect(() =>
      editorExtensionMetadataSchema.parse({ ...metadata, id: "ACME/Bad" }),
    ).toThrow();
    expect(() =>
      editorExtensionMetadataSchema.parse({
        ...metadata,
        sha256: "not-a-digest",
      }),
    ).toThrow();
  });

  it("validates installation metadata and exact project references", () => {
    const installed = {
      ...metadata,
      installationId: "00000000-0000-4000-8000-000000000123",
      source: "vsix",
      createdAt: "2026-10-11T12:00:00.000Z",
    };
    expect(installedEditorExtensionSchema.parse(installed)).toEqual(installed);
    const reference = {
      installationId: "00000000-0000-4000-8000-000000000123",
      sha256: metadata.sha256,
    };
    expect(projectEditorExtensionReferencesSchema.parse([reference])).toEqual([
      reference,
    ]);
    expect(() =>
      projectEditorExtensionReferencesSchema.parse([reference, reference]),
    ).toThrow();
    expect(() =>
      projectEditorExtensionReferencesSchema.parse(
        Array.from({ length: 33 }, (_, i) => ({
          installationId: `ins_${i}`,
          sha256: metadata.sha256,
        })),
      ),
    ).toThrow();
  });
});
