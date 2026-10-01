import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(import.meta.dirname, "..");

export function createPlugin(name, workspace = root) {
  if (
    typeof name !== "string" ||
    name.length > 31 ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)
  )
    throw new Error(
      "Use a lowercase plugin name, for example: pnpm plugin:create tasks",
    );
  const directory = join(workspace, "packages", `plugin-${name}`);
  mkdirSync(directory); // Refuse overwriting any existing directory.
  const collection = name.replaceAll("-", "_");
  const label = name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
  const json = (file, value) =>
    writeFileSync(join(directory, file), JSON.stringify(value, null, 2) + "\n");
  json("package.json", {
    name: `@savia/plugin-${name}`,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { test: "vitest run", typecheck: "tsc --noEmit" },
    dependencies: {
      "@savia/plugin-sdk": "workspace:*",
      "@savia/plugin-ui": "workspace:*",
      react: "^19.2.8",
      "react-dom": "^19.2.8",
    },
    devDependencies: {
      "@types/react": "^19.2.18",
      "@types/react-dom": "^19.2.3",
      typescript: "^5.9.3",
      vitest: "^4.1.11",
    },
  });
  json("savia-extension.json", {
    format: "savia.extension",
    formatVersion: 1,
    id: `custom.${name}`,
    version: "1.0.0",
    label,
    description: `${label} workspace plugin`,
    requires: [],
    apiVersion: 1,
  });
  const definition = {
    name: collection,
    label,
    description: "",
    config: {
      version: 2,
      fields: { name: { type: "Textbox", label: "Name", required: true } },
      fieldOrder: ["name"],
    },
  };
  json("store.json", {
    format: "savia.store",
    formatVersion: 1,
    collections: [
      { object: definition, requiredFields: { name: { types: ["Textbox"] } } },
    ],
    screens: [{ object: collection, view: "records", lookupFields: ["name"] }],
  });
  json("tsconfig.json", {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      noEmit: true,
      resolveJsonModule: true,
    },
    include: ["entry.tsx", "test"],
  });
  writeFileSync(
    join(directory, "entry.tsx"),
    `import type { PluginApi } from "@savia/plugin-sdk";
import { defineReactPlugin } from "@savia/plugin-sdk/react";
import { Workbench, type WorkbenchConfig } from "@savia/plugin-ui";
import "@savia/plugin-ui/workbench.css";

const config: WorkbenchConfig = {
  object: "${collection}", title: "${label}", description: "Manage your workspace records.",
  singular: "Record", createLabel: "New record",
  fields: [{ key: "name", label: "Name", required: true, lookup: true }],
  defaults: { name: "" }, stages: [],
  columns: [{ key: "name", label: "Name", render: record => String(record.name ?? "") }],
  filters: [{ value: "all", label: "All" }], matches: () => true,
  metrics: records => [{ label: "Records", value: records.length, detail: "In this collection" }],
  validate: record => String(record.name ?? "").trim() ? null : "Name is required.",
  exportHeaders: ["Name"], exportRow: record => [record.name],
};
function Screen({ savia }: { savia: PluginApi }) {
  return <Workbench savia={savia} config={config} />;
}
const plugin = defineReactPlugin(Screen);
export const { render, renderPanel } = plugin;
`,
  );
  mkdirSync(join(directory, "test"));
  writeFileSync(
    join(directory, "test", "collections.test.ts"),
    `import { expect, it } from "vitest";
import { createMockPluginApi } from "@savia/plugin-sdk/testing";

it("creates and searches records through the plugin API", async () => {
  const savia = createMockPluginApi({ collections: [{
    definition: { name: "${collection}", label: "${label}", description: "", config: { version: 2, fields: { name: { type: "Textbox", label: "Name" } }, fieldOrder: ["name"] } },
    records: [],
  }] });
  const collection = savia.collections.collection<{id: string; name: string}>("${collection}");
  await collection.create({ name: "Example" });
  const page = await collection.list({ q: "Example", searchFields: ["name"] });
  expect(page.data).toHaveLength(1);
});
`,
  );
  writeFileSync(
    join(directory, "README.md"),
    `# ${label}\n\nRun from the repository root:\n\n\`\`\`sh\npnpm install\npnpm dev\n# In a second terminal:\npnpm plugin:dev packages/plugin-${name} --tenant 0\npnpm --filter @savia/plugin-${name} test\npnpm --filter @savia/plugin-${name} typecheck\n\`\`\`\n\nThe development command targets local tenants only, installs immutable build versions,\nand refreshes the plugin inside Savia after successful builds, preserving the current route. Unsaved plugin forms reset when the plugin remounts.\nProduction packaging: \`pnpm store:pack packages/plugin-${name}\`.\nSee [Plugin development](../../docs/guides/plugin-development.md).\n`,
  );
  return directory;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      `Created ${createPlugin(process.argv[2])}\nRun pnpm install, then pnpm dev and pnpm plugin:dev <directory> --tenant 0.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
