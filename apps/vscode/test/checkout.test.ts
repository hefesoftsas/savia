import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { checkoutProject } from "../src/checkout";
import { readLocalProject, selectProjectRoot } from "../src/project";
import type { PluginCheckout } from "@savia/studio-shared/plugin-development";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "savia-authoring-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const profile = {
  id: "profile",
  origin: "https://savia.test",
  tenantId: 12,
  principalId: "author",
};
const files = {
  "entry.tsx": "export function render() {}",
  "savia-extension.json": JSON.stringify({
    format: "savia.extension",
    formatVersion: 1,
    id: "custom.example",
    version: "1.0.0",
    label: "Example",
    description: "",
    requires: [],
    apiVersion: 1,
  }),
  "store.json": JSON.stringify({ format: "savia.store", formatVersion: 1 }),
  "preview.json": JSON.stringify({ collections: {}, settings: {} }),
};
function snapshot(archive?: Record<string, string>): PluginCheckout {
  return {
    pluginId: "custom.example",
    sourceVersion: "1.0.0",
    sourceSha256: "a".repeat(64),
    head: { version: "1.1.0", sha256: "b".repeat(64) },
    sharedHead: null,
    authoringKind: "authored",
    entryPath: archive ? "packages/example/src/entry.tsx" : "entry.tsx",
    files: {
      ...files,
      ...(archive ? { "original-source.json": JSON.stringify(archive) } : {}),
    },
  };
}
const uri = (path: string) => ({ scheme: "file", fsPath: path });
it("checks out a plain authored project and retains a historical base under the current head", async () => {
  const descriptor = await checkoutProject(uri(root), snapshot(), profile);
  expect(descriptor).toMatchObject({
    sourceVersion: "1.0.0",
    expectedHead: { version: "1.1.0" },
    entryPath: "entry.tsx",
    origin: profile.origin,
  });
  expect(await fs.readFile(join(root, "entry.tsx"), "utf8")).toBe(
    files["entry.tsx"],
  );
  expect(
    await fs.readFile(join(root, ".savia/types/plugin.d.ts"), "utf8"),
  ).toContain("createRoot");
  const project = await readLocalProject(uri(root), profile);
  expect(project.files).toEqual(files);
  expect(JSON.stringify(descriptor)).not.toContain("token");
});
it("materializes nested original source and real image bytes and reads edited files back into the archive", async () => {
  const archive = {
    "packages/example/src/entry.tsx":
      "import image from './image.png'; export function render() {}",
    "packages/example/src/image.png": "data:image/png;base64,iVBORw0KGgo=",
    "packages/example/src/image.webp": "data:image/webp;base64,UklGRg==",
    "packages/example/src/style.css": ".example{color:red}",
  };
  const descriptor = await checkoutProject(
    uri(root),
    snapshot(archive),
    profile,
  );
  expect(descriptor.entryPath).toBe("packages/example/src/entry.tsx");
  expect(
    new Uint8Array(
      await fs.readFile(join(root, "packages/example/src/image.png")),
    ),
  ).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  await expect(fs.stat(join(root, "entry.tsx"))).rejects.toThrow();
  await fs.writeFile(
    join(root, "packages/example/src/entry.tsx"),
    "export function render() { /* edited */ }",
  );
  await fs.writeFile(
    join(root, "packages/example/src/new.ts"),
    "export const added=true;",
  );
  const project = await readLocalProject(uri(root), profile);
  expect(JSON.parse(project.files["original-source.json"]!)).toEqual({
    ...archive,
    "packages/example/src/entry.tsx":
      "export function render() { /* edited */ }",
    "packages/example/src/new.ts": "export const added=true;",
  });
  expect(
    Object.keys(JSON.parse(project.files["original-source.json"]!)).some(
      (path) => path.startsWith(".savia/"),
    ),
  ).toBe(false);
});
it("does not overwrite a nonempty folder or make compiled-only releases editable", async () => {
  await fs.writeFile(join(root, "notes.txt"), "Keep my work");
  await expect(checkoutProject(uri(root), snapshot(), profile)).rejects.toThrow(
    "empty",
  );
  expect(await fs.readFile(join(root, "notes.txt"), "utf8")).toBe(
    "Keep my work",
  );
  await fs.unlink(join(root, "notes.txt"));
  await expect(
    checkoutProject(
      uri(root),
      { ...snapshot(), authoringKind: "compiled-only" },
      profile,
    ),
  ).rejects.toThrow("compiled");
  expect(await fs.readdir(root)).toEqual([]);
});
it.each([
  "../outside.ts",
  "/outside.ts",
  "C:/outside.ts",
  "src\\outside.ts",
  "src/CON.ts",
  ".savia/secret.ts",
  "src/trailing.ts ",
])(
  "rejects unsafe authored path %s before creating a descriptor",
  async (path) => {
    const checkout = snapshot({
      "packages/example/src/entry.tsx": "export function render() {}",
      [path]: "unsafe",
    });
    await expect(
      checkoutProject(uri(root), checkout, profile),
    ).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  },
);
it.each([
  ["src/Name.ts", "src/name.ts"],
  ["src/caf\u00e9.ts", "src/cafe\u0301.ts"],
  ["Src/one.ts", "src/two.ts"],
])("rejects portable path collisions %j", async (first, second) => {
  await expect(
    checkoutProject(
      uri(root),
      snapshot({
        "packages/example/src/entry.tsx": "export function render() {}",
        [first]: "one",
        [second]: "two",
      }),
      profile,
    ),
  ).rejects.toThrow("collision");
  expect(await fs.readdir(root)).toEqual([]);
});
it("rejects a symlink target and a target substituted while staging files", async () => {
  const outside = await fs.mkdtemp(join(tmpdir(), "savia-outside-"));
  try {
    const target = join(root, "checkout");
    await fs.symlink(outside, target, "dir");
    await expect(
      checkoutProject(uri(target), snapshot(), profile),
    ).rejects.toThrow("symlink");
    await fs.unlink(target);
    await fs.mkdir(target);
    const original = fs.writeFile.bind(fs);
    let substituted = false;
    vi.spyOn(fs, "writeFile").mockImplementation(
      async (path, ...args: any[]) => {
        if (!substituted) {
          substituted = true;
          await fs.rmdir(target);
          await fs.symlink(outside, target, "dir");
        }
        return original(path, ...(args as [any, any]));
      },
    );
    await expect(
      checkoutProject(uri(target), snapshot(), profile),
    ).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});
it("requires descriptor profile matching and refuses source symlinks on subsequent reads", async () => {
  await checkoutProject(uri(root), snapshot(), profile);
  await expect(
    readLocalProject(uri(root), { ...profile, origin: "https://other.test" }),
  ).rejects.toThrow("connection");
  const outside = await fs.mkdtemp(join(tmpdir(), "savia-read-outside-"));
  try {
    await fs.writeFile(join(outside, "entry.tsx"), "private source");
    await fs.unlink(join(root, "entry.tsx"));
    await fs.symlink(join(outside, "entry.tsx"), join(root, "entry.tsx"));
    await expect(readLocalProject(uri(root), profile)).rejects.toThrow(
      "symlink",
    );
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});
it("requires an explicit selection when a workspace has multiple project roots", async () => {
  const roots = [uri(root), uri(join(root, "other"))];
  let choices = 0;
  expect(
    await selectProjectRoot(roots, async (items) => {
      choices++;
      return items[1];
    }),
  ).toEqual(roots[1]);
  expect(choices).toBe(1);
  expect(await selectProjectRoot(roots, async () => undefined)).toBeUndefined();
});

it("rejects repository and executable editor configuration paths", async () => {
  for (const path of [
    ".git/config.json",
    ".vscode/tasks.json",
    "node_modules/library/index.js",
  ])
    await expect(
      checkoutProject(
        uri(root),
        snapshot({
          "packages/example/src/entry.tsx": "export function render() {}",
          [path]: "{}",
        }),
        profile,
      ),
    ).rejects.toThrow("Reserved");
  expect(await fs.readdir(root)).toEqual([]);
});
it("restores an empty target after a failed staging commit", async () => {
  vi.spyOn(fs, "rename").mockRejectedValueOnce(
    new Error("Simulated filesystem rename failure"),
  );
  await expect(
    checkoutProject(uri(root), snapshot(), profile),
  ).rejects.toThrow();
  expect(await fs.readdir(root)).toEqual([]);
});
it("rejects invalid UTF-8 source instead of publishing replacement characters", async () => {
  await checkoutProject(uri(root), snapshot(), profile);
  await fs.writeFile(join(root, "entry.tsx"), new Uint8Array([255]));
  await expect(readLocalProject(uri(root), profile)).rejects.toThrow();
});
it("retains nested authored dist folders instead of treating them as generated output", async () => {
  const archive = {
    "packages/example/src/entry.tsx":
      "import { value } from './dist/value'; export function render() {}",
    "packages/example/src/dist/value.ts": "export const value=1;",
  };
  await checkoutProject(uri(root), snapshot(archive), profile);
  expect(
    JSON.parse(
      (await readLocalProject(uri(root), profile)).files[
        "original-source.json"
      ]!,
    ),
  ).toEqual(archive);
});

it("packages edits and binary assets from ordinary checkout files with the shared compiler", async () => {
  const archive = {
    "packages/example/src/entry.tsx":
      'export function render(el) { el.textContent="Before"; }',
    "packages/example/src/image.png": "data:image/png;base64,iVBORw0KGgo=",
  };
  await checkoutProject(uri(root), snapshot(archive), profile);
  await fs.writeFile(
    join(root, "packages/example/src/entry.tsx"),
    'export function render(el) { el.textContent="Changed from VS Code"; }',
  );
  await fs.writeFile(
    join(root, "packages/example/src/image.png"),
    new Uint8Array([1, 2, 3, 4]),
  );
  const { packageAuthoringProject } =
    await import("@savia/plugin-authoring/compiler");
  const { buildPluginIdeBundles } =
    await import("../../admin/build/plugin-ide-runtime");
  const { parsePluginStoreZip } =
    await import("../../../packages/studio-server/src/plugin-store");
  const project = await readLocalProject(uri(root), profile);
  const packaged = await packageAuthoringProject(
    project.files,
    await buildPluginIdeBundles(),
  );
  const parsed = await parsePluginStoreZip(packaged.zipBytes);
  expect(parsed.entryJs).toContain("Changed from VS Code");
  expect(
    JSON.parse(parsed.sourceFiles!["original-source.json"]!)[
      "packages/example/src/image.png"
    ],
  ).toBe("data:image/png;base64,AQIDBA==");
});

it("rejects a selected folder whose ancestor redirects checkout outside the chosen path", async () => {
  const outside = await fs.mkdtemp(join(tmpdir(), "savia-parent-outside-"));
  try {
    await fs.mkdir(join(outside, "project"));
    await fs.symlink(outside, join(root, "redirect"), "dir");
    await expect(
      checkoutProject(uri(join(root, "redirect/project")), snapshot(), profile),
    ).rejects.toThrow("symlink");
    expect(await fs.readdir(join(outside, "project"))).toEqual([]);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});
