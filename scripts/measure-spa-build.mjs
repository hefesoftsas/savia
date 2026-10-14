import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repository, "apps/admin/package.json"));
const { parse } = require("acorn");

export async function measureSpaBuild(directory) {
  const root = resolve(directory);
  const files = new Map();
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else
        files.set(
          relative(root, file).replaceAll("\\", "/"),
          (await stat(file)).size,
        );
    }
  }
  await walk(root);
  const original = [...files].filter(([name]) => !/\.(?:gz|br)$/.test(name));
  const js = original.filter(
    ([name]) => name.startsWith("assets/") && name.endsWith(".js"),
  );
  const html = await readFile(join(root, "index.html"), "utf8");
  const initial = [
    ...html.matchAll(
      /<(?:script|link)\b[^>]*(?:src|href)="([^"]+\.(?:js|css))"[^>]*>/g,
    ),
  ].map((x) => x[1].replace(/^\//, ""));
  const pick = (pattern) =>
    js
      .filter(([name]) => pattern.test(name))
      .sort((a, b) => b[1] - a[1])[0]?.[0];
  // The private application is lazily imported by bootstrap; include it for
  // authenticated startup. Optional navigation prefetch and SW population are
  // reported separately from this deterministic cold dependency payload.
  const privateApp = pick(/^assets\/app-[\w-]+\.js$/);
  const myDay = pick(/^assets\/my-day-page-[\w-]+\.js$/);
  if (!privateApp || !myDay)
    throw new Error("Missing private app or My Day entry");
  const cache = new Map();
  const preloads = new Map();
  function walkAst(root, callback) {
    const queue = [root];
    while (queue.length) {
      const node = queue.pop();
      if (!node || typeof node !== "object") continue;
      if (node.type) callback(node);
      for (const child of Object.values(node)) {
        if (Array.isArray(child))
          queue.push(...child.filter((x) => x && typeof x === "object"));
        else if (child && typeof child === "object") queue.push(child);
      }
    }
  }
  function localImport(name, specifier) {
    return specifier.startsWith("/")
      ? specifier.slice(1)
      : join(dirname(name), specifier).replaceAll("\\", "/");
  }
  async function dependencies(name) {
    if (cache.has(name)) return cache.get(name);
    const result = [];
    if (name.endsWith(".js")) {
      const code = await readFile(join(root, name), "utf8");
      const ast = parse(code, { ecmaVersion: "latest", sourceType: "module" });
      let preloadFiles;
      for (const node of ast.body) {
        if (node.type !== "VariableDeclaration") continue;
        for (const declaration of node.declarations) {
          if (declaration.id.name !== "__vite__mapDeps") continue;
          walkAst(declaration.init, (node) => {
            if (
              node.type === "ArrayExpression" &&
              node.elements.every((x) => typeof x?.value === "string")
            ) {
              preloadFiles = node.elements.map((x) =>
                x.value.replace(/^\//, ""),
              );
            }
          });
        }
      }
      // CSS for a lazy entry is encoded in Vite's preload wrapper rather than
      // a static ESM import. Include only wrappers for selected startup roots,
      // not every optional route enumerated in the same map.
      walkAst(ast, (node) => {
        if (node.type !== "CallExpression" || node.arguments.length < 2) return;
        const metadata = node.arguments[1];
        if (
          metadata?.type !== "CallExpression" ||
          metadata.callee?.name !== "__vite__mapDeps"
        )
          return;
        const indexes = metadata.arguments[0];
        if (!preloadFiles || indexes?.type !== "ArrayExpression")
          throw new Error(`Unsupported Vite preload metadata in ${name}`);
        const targets = [];
        walkAst(node.arguments[0], (child) => {
          if (child.type !== "ImportExpression") return;
          const source = child.source;
          const specifier =
            source?.type === "TemplateLiteral" &&
            source.expressions.length === 0
              ? source.quasis[0].value.cooked
              : source?.value;
          if (typeof specifier === "string")
            targets.push(localImport(name, specifier));
        });
        const assets = indexes.elements.map((index) => {
          const asset = preloadFiles[index?.value];
          if (!asset) throw new Error(`Invalid Vite preload index in ${name}`);
          return asset;
        });
        for (const target of targets)
          preloads.set(target, [
            ...new Set([...(preloads.get(target) ?? []), ...assets]),
          ]);
      });
      for (const node of ast.body) {
        if (
          node.type === "ImportDeclaration" ||
          ((node.type === "ExportNamedDeclaration" ||
            node.type === "ExportAllDeclaration") &&
            node.source)
        ) {
          const specifier = node.source.value;
          if (specifier.startsWith("."))
            result.push(join(dirname(name), specifier).replaceAll("\\", "/"));
          else if (specifier.startsWith("/")) result.push(specifier.slice(1));
        }
      }
    }
    cache.set(name, result);
    return result;
  }
  async function closure(entries) {
    const visited = new Set();
    async function visit(name) {
      if (visited.has(name)) return;
      if (!files.has(name)) throw new Error(`Missing dependency: ${name}`);
      visited.add(name);
      for (const dependency of await dependencies(name))
        await visit(dependency);
    }
    for (const entry of entries) await visit(entry);
    // Visiting parents discovers metadata for their lazy startup children.
    for (const entry of entries)
      for (const asset of preloads.get(entry) ?? []) await visit(asset);
    const assets = [];
    for (const name of [...visited].sort()) {
      const data = await readFile(join(root, name));
      assets.push({
        name,
        bytes: data.length,
        gzipBytes: gzipSync(data, { level: 6 }).length,
        brotliBytes: brotliCompressSync(data, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
        }).length,
      });
    }
    return {
      requests: assets.length,
      bytes: assets.reduce((n, x) => n + x.bytes, 0),
      gzipBytes: assets.reduce((n, x) => n + x.gzipBytes, 0),
      brotliBytes: assets.reduce((n, x) => n + x.brotliBytes, 0),
      assets,
    };
  }
  return {
    method:
      "Production files; HTML JS/CSS plus static ESM closure and Vite preload assets for selected startup roots. Authenticated startup adds the private application and My Day, including lazy entry CSS. Compression measured per file; excludes API, images, idle prefetch and service-worker population. Not a network timing or Web Vitals measurement.",
    installers: {
      files: original.filter(([name]) => name.startsWith("downloads/")).length,
      bytes: original
        .filter(([name]) => name.startsWith("downloads/"))
        .reduce((n, x) => n + x[1], 0),
    },
    originals: {
      files: original.length,
      bytes: original.reduce((n, x) => n + x[1], 0),
    },
    published: {
      files: files.size,
      bytes: [...files.values()].reduce((n, x) => n + x, 0),
    },
    sidecars: {
      files: files.size - original.length,
      bytes:
        [...files.values()].reduce((n, x) => n + x, 0) -
        original.reduce((n, x) => n + x[1], 0),
    },
    boot: await closure(initial),
    authenticatedMyDay: await closure([...initial, privateApp, myDay]),
    largest: original
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, bytes]) => ({ name, bytes })),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await measureSpaBuild(
    process.argv[2] ?? join(repository, "apps/admin/dist"),
  );
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        ...result,
        boot: { ...result.boot, assets: undefined },
        authenticatedMyDay: { ...result.authenticatedMyDay, assets: undefined },
      },
      null,
      2,
    ),
  );
}
