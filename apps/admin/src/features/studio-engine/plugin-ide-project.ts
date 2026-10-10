import runtimeBundle from "virtual:savia-plugin-ide-runtime";
import {
  pluginStoreManifestSchema,
  sanitizeStoreCollection,
  storeJsonSchema,
  validatePluginEntrySource,
  type PluginStoreManifest,
  type StoreJson,
} from "@savia/studio-shared/plugin-store";
import { pluginAuthoringPreviewSchema } from "@savia/studio-shared/plugin-authoring";
import {
  pluginProjectFilesSchema,
  PLUGIN_PROJECT_MAX_BYTES as MAX_PROJECT_BYTES,
} from "@savia/studio-shared/plugin-projects";

import { compilePluginSourceArchive } from "./plugin-source-compiler";

export type IdeFiles = {
  "entry.tsx": string;
  "savia-extension.json": string;
  "store.json": string;
  "preview.json": string;
  "original-source.json"?: string;
};

export type PluginIdeFixtures = {
  collections: Record<string, Record<string, unknown>[]>;
  settings: Record<string, unknown>;
};

const projectFileNames = [
  "entry.tsx",
  "savia-extension.json",
  "store.json",
  "preview.json",
] as const;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function validateIdeFiles(value: unknown): IdeFiles {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Project files must be an object.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (name) => ![...projectFileNames, "original-source.json"].includes(name),
    )
  )
    throw new Error("Project contains unsupported files.");
  const files = pluginProjectFilesSchema.parse(record);
  const bytes = new TextEncoder().encode(JSON.stringify(files)).byteLength;
  if (bytes > MAX_PROJECT_BYTES)
    throw new Error("Project exceeds the 5 MB limit.");
  return files;
}

function parseFixtures(text: string): PluginIdeFixtures {
  const raw = parseJson(text, "preview.json");
  assertSafeFixtureKeys(raw, "preview");
  const candidate = pluginAuthoringPreviewSchema.parse(raw);
  const collections: PluginIdeFixtures["collections"] = {};
  for (const [name, rows] of Object.entries(candidate.collections)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(name))
      throw new Error(`Invalid preview collection: ${name}.`);
    assertSafeFixtureKeys(rows, `collections.${name}`);
    collections[name] = rows as Record<string, unknown>[];
  }
  assertSafeFixtureKeys(candidate.settings, "settings");
  return {
    collections,
    settings: candidate.settings as Record<string, unknown>,
  };
}

function assertSafeFixtureKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeFixtureKeys(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error(`Unsafe fixture key at ${path}.${key}.`);
    assertSafeFixtureKeys(nested, `${path}.${key}`);
  }
}

export function createPluginProject(): IdeFiles {
  const id = `custom.plugin-${crypto.randomUUID()}`;
  const manifest = {
    format: "savia.extension",
    formatVersion: 1,
    id,
    version: "1.0.0",
    label: "New plugin",
    description: "A plugin created in the Savia plugin IDE.",
    requires: [],
    apiVersion: 1,
  };
  const store: StoreJson = {
    format: "savia.store",
    formatVersion: 1,
    actions: [],
    connectors: [],
    collections: [],
    bundles: [],
    widgets: [],
    screens: [],
  };
  return {
    "entry.tsx": `export function render(element: HTMLElement, savia: any) {\n  const root = createRoot(element);\n  let count = 0;\n\n  function Counter() {\n    const [value, setValue] = React.useState(count);\n    return (\n      <section style={{ padding: 20 }}>\n        <h2>Savia plugin</h2>\n        <p>Counter: {value}</p>\n        <button onClick={() => { count += 1; setValue(count); }}>Add one</button>\n      </section>\n    );\n  }\n\n  root.render(<Counter />);\n  return () => root.unmount();\n}\n`,
    "savia-extension.json": json(manifest),
    "store.json": json(store),
    "preview.json": json({ collections: {}, settings: {} }),
  };
}

function rejectSourceImports(source: string): void {
  if (/\bimport\b\s*(?:\(|[\w{*'"])/.test(source))
    throw new Error(
      "Plugin source cannot contain imports; runtime modules are injected by Savia.",
    );
}

export async function compilePluginProject(filesInput: IdeFiles): Promise<{
  entryJs: string;
  manifest: PluginStoreManifest;
  store: StoreJson;
  fixtures: PluginIdeFixtures;
}> {
  const files = validateIdeFiles(filesInput);
  const manifest = pluginStoreManifestSchema.parse(
    parseJson(files["savia-extension.json"], "savia-extension.json"),
  );
  const storeInput = parseJson(files["store.json"], "store.json");
  const store = storeJsonSchema.parse(storeInput);
  for (const collection of store.collections)
    sanitizeStoreCollection(collection);
  const fixtures = parseFixtures(files["preview.json"]);
  if (files["original-source.json"]) {
    const entryJs = await compilePluginSourceArchive(
      files["original-source.json"],
    );
    return { entryJs, manifest, store, fixtures };
  }
  rejectSourceImports(files["entry.tsx"]);
  validatePluginEntrySource(files["entry.tsx"]);

  const { transform } = await import("sucrase");
  const transformed = transform(files["entry.tsx"], {
    transforms: ["typescript", "jsx"],
    jsxRuntime: "classic",
    production: true,
  });
  const entryJs = [
    runtimeBundle,
    "const React = SaviaPluginReact.React;",
    "const createRoot = SaviaPluginReact.createRoot;",
    transformed.code,
  ].join("\n");
  validatePluginEntrySource(entryJs);
  return { entryJs, manifest, store, fixtures };
}

export function serializePluginProject(filesInput: IdeFiles): string {
  const files = validateIdeFiles(filesInput);
  const serialized = json({
    format: "savia.plugin-ide-project",
    formatVersion: 1,
    files,
  });
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROJECT_BYTES)
    throw new Error("Project exceeds the 5 MB limit.");
  return serialized;
}

export function parsePluginProject(text: string): IdeFiles {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES)
    throw new Error("Project exceeds the 5 MB limit.");
  const value = parseJson(text, "Project");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Project must be an object.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    record.format !== "savia.plugin-ide-project" ||
    record.formatVersion !== 1 ||
    !record.files
  )
    throw new Error("Unsupported plugin IDE project format.");
  return validateIdeFiles(record.files);
}

export async function packagePluginProject(files: IdeFiles): Promise<{
  blob: Blob;
  manifest: PluginStoreManifest;
  entryJs: string;
}> {
  const compiled = await compilePluginProject(files);
  const zipEntries = [
    { name: "savia-extension.json", data: json(compiled.manifest) },
    { name: "dist/plugin.js", data: compiled.entryJs },
    { name: "store.json", data: json(compiled.store) },
    { name: "src/entry.tsx", data: files["entry.tsx"] },
    { name: "src/preview.json", data: files["preview.json"] },
    ...(files["original-source.json"]
      ? [
          {
            name: "src/original-source.json",
            data: files["original-source.json"],
          },
        ]
      : []),
  ];
  const { encodeStoredZip } = await import("./plugin-ide-zip");
  return {
    blob: new Blob([encodeStoredZip(zipEntries).buffer as ArrayBuffer], {
      type: "application/zip",
    }),
    manifest: compiled.manifest,
    entryJs: compiled.entryJs,
  };
}
