import { expect, it } from "vitest";
import { PluginTreeProvider } from "../src/tree";
import { PublishedSourceProvider } from "../src/documents";
const catalog = [
  {
    pluginId: "custom.example",
    label: "Example",
    head: { version: "2.0.0", sha256: "b".repeat(64) },
    installedVersion: "1.0.0",
    versions: [
      {
        version: "2.0.0",
        sha256: "b".repeat(64),
        createdAt: "2026-10-12",
        authored: true,
      },
      {
        version: "1.0.0",
        sha256: "a".repeat(64),
        createdAt: "2026-10-11",
        authored: true,
      },
    ],
  },
];
it("groups published versions and marks latest independently of installed", () => {
  const tree = new PluginTreeProvider();
  tree.setCatalog(catalog);
  const roots = tree.getChildren();
  expect(roots.map((node) => node.pluginId)).toEqual(["custom.example"]);
  const versions = tree.getChildren(roots[0]);
  expect(
    versions.map((node) => [node.version, node.latest, node.installed]),
  ).toEqual([
    ["2.0.0", true, false],
    ["1.0.0", false, true],
  ]);
  tree.setCatalog([]);
  expect(tree.getChildren()).toEqual([]);
});
it("keeps historical source documents distinct by profile and version and releases them on disconnect", () => {
  const provider = new PublishedSourceProvider();
  const old = provider.add("profile", "custom.example", "1.0.0", {
    "entry.tsx": "old source",
  });
  const current = provider.add("profile", "custom.example", "2.0.0", {
    "entry.tsx": "new source",
  });
  expect(old[0].uri).not.toBe(current[0].uri);
  expect(old[0].uri.startsWith("savia-source:")).toBe(true);
  expect(
    provider.provideTextDocumentContent({ toString: () => old[0].uri }),
  ).toBe("old source");
  provider.clear();
  expect(() =>
    provider.provideTextDocumentContent({ toString: () => old[0].uri }),
  ).toThrow();
});
