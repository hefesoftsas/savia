import runtimeBundle from "virtual:savia-plugin-ide-runtime";
import vendorBundles from "virtual:savia-plugin-ide-vendors";
import { parsePluginOriginalSourceFiles } from "@savia/studio-shared/plugin-projects";
import { validatePluginEntrySource } from "@savia/studio-shared/plugin-store";

export function pluginSourceEntry(files: Record<string, string>): string {
  const names = Object.keys(files);
  const entries = names.filter((name) =>
    /(?:^|\/)entry\.(?:tsx|jsx|js)$/.test(name),
  );
  if (entries.length > 1)
    throw new Error(
      `Plugin source has ambiguous entry modules: ${entries.join(", ")}.`,
    );
  const entry = entries[0];
  if (!entry)
    throw new Error(
      "Plugin source must include an entry.tsx, entry.jsx or entry.js module.",
    );
  return entry;
}

/** Serialize code literals safely even if a consumer embeds the bundle in HTML. */
function javascriptLiteral(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined)
    throw new Error("Cannot serialize an undefined code literal.");
  const escapes: Record<string, string> = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
  };
  return json.replace(/[<>&\u2028\u2029]/g, (character) => escapes[character]);
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length)
        throw new Error(`Import escapes plugin source: ${path}`);
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

/** Earlier archives omitted binary assets; preserve their exact compiled recovery path. */
export function findMissingPluginSourceAssets(archive: string): string[] {
  const files = parsePluginOriginalSourceFiles(archive);
  const missing = new Set<string>();
  for (const [name, text] of Object.entries(files)) {
    if (!/\.(?:tsx?|jsx?)$/.test(name)) continue;
    for (const match of text.matchAll(
      /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+\.(?:svg|png|webp))["']/g,
    )) {
      if (!match[1].startsWith(".")) continue;
      const path = normalizePath(
        `${name.slice(0, name.lastIndexOf("/") + 1)}${match[1]}`,
      );
      if (!Object.hasOwn(files, path)) missing.add(path);
    }
  }
  return [...missing];
}

/** Build only retained modules and shipped dependencies; never fetch or evaluate code. */
export async function compilePluginSourceArchive(
  archive: string,
): Promise<string> {
  const files = parsePluginOriginalSourceFiles(archive);
  const entry = pluginSourceEntry(files);
  const [{ transform }, { parse }] = await Promise.all([
    import("sucrase"),
    import("acorn"),
  ]);
  const modules = new Map<string, string>();
  const vendors = new Set<string>();
  const supported = new Set(["react", "react-dom/client", "zod", "pdf-lib"]);
  function resolve(specifier: string, importer: string): string {
    if (supported.has(specifier)) {
      vendors.add(specifier);
      return specifier;
    }
    let path: string;
    if (specifier.startsWith("."))
      path = normalizePath(
        `${importer.slice(0, importer.lastIndexOf("/") + 1)}${specifier}`,
      );
    else if (specifier.startsWith("@savia/")) {
      const [name, ...parts] = specifier.slice(7).split("/");
      path = `packages/${name}/src/${parts.join("/") || "index"}`;
    } else throw new Error(`${importer}: unsupported dependency ${specifier}.`);
    const result = [
      path,
      ...[
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        "/index.ts",
        "/index.tsx",
        "/index.js",
      ].map((suffix) => path + suffix),
    ].find((candidate) => Object.hasOwn(files, candidate));
    if (!result)
      throw new Error(`${importer}: missing source module ${specifier}.`);
    return result;
  }
  function visit(name: string): void {
    if (supported.has(name) || modules.has(name)) return;
    // Register before following imports to preserve CommonJS cycle semantics.
    modules.set(name, "");
    const source = files[name];
    let code: string;
    if (name.endsWith(".css")) {
      code = `const style = document.createElement("style"); style.textContent = ${javascriptLiteral(source)}; document.head.appendChild(style);`;
    } else if (name.endsWith(".json")) {
      code = `module.exports = ${javascriptLiteral(JSON.parse(source))};`;
    } else if (/\.(png|webp)$/.test(name)) {
      if (!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/.test(source))
        throw new Error(`Invalid retained image: ${name}`);
      code = `module.exports = ${javascriptLiteral(source)};`;
    } else if (name.endsWith(".svg")) {
      code = `module.exports = ${javascriptLiteral(`data:image/svg+xml,${encodeURIComponent(source)}`)};`;
    } else {
      code = transform(source, {
        transforms: ["typescript", "jsx", "imports"],
        jsxRuntime: "classic",
        production: true,
        filePath: name,
      }).code;
      // Parse transformed JavaScript so comments, strings and template text
      // cannot be mistaken for imports. Never execute source during building.
      const ast = parse(code, { ecmaVersion: "latest", sourceType: "script" });
      const pending: unknown[] = [ast];
      const replacements: Array<{ start: number; end: number; code: string }> =
        [];
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== "object") continue;
        const node = value as Record<string, unknown>;
        const callee = node.callee as Record<string, unknown> | undefined;
        const dynamic = node.type === "ImportExpression";
        const required =
          node.type === "CallExpression" &&
          callee?.type === "Identifier" &&
          callee.name === "require";
        if (dynamic || required) {
          const args = node.arguments as
            Array<Record<string, unknown>> | undefined;
          const literal = dynamic
            ? (node.source as Record<string, unknown>)
            : args?.[0];
          if (
            literal?.type !== "Literal" ||
            typeof literal.value !== "string" ||
            (required && args?.length !== 1)
          )
            throw new Error(
              `${name}: imports require a retained literal module path.`,
            );
          const dependency = resolve(literal.value, name);
          visit(dependency);
          const loaded = `__saviaImport(${javascriptLiteral(dependency)})`;
          replacements.push({
            start: node.start as number,
            end: node.end as number,
            code: dynamic ? `Promise.resolve().then(() => ${loaded})` : loaded,
          });
          continue;
        }
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) pending.push(...child);
          else if (child && typeof child === "object") pending.push(child);
        }
      }
      for (const replacement of replacements.sort((a, b) => b.start - a.start))
        code =
          code.slice(0, replacement.start) +
          replacement.code +
          code.slice(replacement.end);
    }
    modules.set(name, code);
  }
  visit(entry);
  const dependencies = [...vendors].flatMap((name) =>
    vendorBundles[name] ? [vendorBundles[name]] : [],
  );
  const registry: Record<string, string> = {
    react: "SaviaPluginReact.React",
    "react-dom/client": "{ createRoot: SaviaPluginReact.createRoot }",
    zod: "SaviaPluginZod",
    "pdf-lib": "SaviaPluginPdf",
  };
  const entryJs = [
    runtimeBundle,
    ...dependencies,
    "const React = SaviaPluginReact.React;",
    `const __saviaVendors = {${[...vendors].map((name) => `${javascriptLiteral(name)}: ${registry[name]}`).join(",")}};`,
    `const __saviaModules = {${[...modules].map(([name, code]) => `${javascriptLiteral(name)}: (module, exports, __saviaImport) => {\n${code}\n}`).join(",\n")}};`,
    "const __saviaCache = Object.create(null);",
    `function __saviaImport(name) {
      if (Object.hasOwn(__saviaVendors, name)) return __saviaVendors[name];
      if (Object.hasOwn(__saviaCache, name)) return __saviaCache[name].exports;
      if (!Object.hasOwn(__saviaModules, name)) throw new Error("Missing plugin module: " + name);
      const module = { exports: {} }; __saviaCache[name] = module;
      __saviaModules[name](module, module.exports, __saviaImport); return module.exports;
    }`,
    `const __saviaEntry = __saviaImport(${javascriptLiteral(entry)});`,
    ...["render", "renderPanel", "widgets", "screens"].map(
      (name) => `export const ${name} = __saviaEntry.${name};`,
    ),
  ].join("\n");
  validatePluginEntrySource(entryJs);
  return entryJs;
}
