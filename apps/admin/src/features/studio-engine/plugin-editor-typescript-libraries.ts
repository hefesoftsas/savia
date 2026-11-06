import domLib from "typescript/lib/lib.dom.d.ts?raw";

const bundledLibraries = import.meta.glob<string>(
  "../../../node_modules/typescript/lib/lib.es*.d.ts",
  { query: "?raw", import: "default", eager: true },
);
export const pluginEditorTypeScriptLibraries: Record<string, string> = {
  "/workspace/lib.dom.d.ts": domLib,
};
for (const [path, source] of Object.entries(bundledLibraries)) {
  const name = path.split("/").pop()!;
  if (/^lib\.es(?:5|201[5-9]|202[0-2])(?:\..*)?\.d\.ts$/.test(name)) {
    pluginEditorTypeScriptLibraries[`/workspace/${name}`] = source;
  }
}
