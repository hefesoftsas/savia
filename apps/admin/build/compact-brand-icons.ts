import type { Plugin } from "vite";
import { fileURLToPath } from "node:url";

export type BrandIconNode = {
  type: string;
  props: Record<string, unknown>;
  children: Array<BrandIconNode | string>;
};

export type BrandIconVariant = {
  viewBox?: string;
  fill?: string;
  stroke?: string;
  childNodes: Array<BrandIconNode | string>;
};

export type BrandIconVariants = Record<string, BrandIconVariant>;

type CompactNode = [
  type: string,
  props: Record<string, unknown>,
  children: Array<number | string>,
];

export type CompactBrandIconVariants = {
  nodes: CompactNode[];
  strings: string[];
  stringRefPrefix: string;
  variants: Record<
    string,
    Omit<BrandIconVariant, "childNodes"> & { children: Array<number | string> }
  >;
};

/** Intern identical SVG nodes, including their already-interned descendants. */
export function compactBrandIconVariants(
  variants: BrandIconVariants,
): CompactBrandIconVariants {
  const nodes: CompactNode[] = [];
  const nodeIds = new Map<string, number>();
  const stringCounts = new Map<string, number>();
  const sourceStrings = new Set<string>();

  function collectStrings(value: unknown) {
    if (typeof value === "string") {
      sourceStrings.add(value);
      if (value.length > 32) {
        stringCounts.set(value, (stringCounts.get(value) ?? 0) + 1);
      }
    } else if (Array.isArray(value)) {
      value.forEach(collectStrings);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        sourceStrings.add(key);
        collectStrings(child);
      }
    }
  }
  collectStrings(variants);

  const strings: string[] = [];
  const stringIds = new Map<string, number>();
  for (const [value, count] of stringCounts) {
    if (count < 2) continue;
    stringIds.set(value, strings.length);
    strings.push(value);
  }

  let stringRefPrefix = "\u0000savia-brand-string-ref:";
  while ([...sourceStrings].some((value) => value.includes(stringRefPrefix))) {
    stringRefPrefix += "_";
  }

  function compactValue(value: unknown): unknown {
    if (typeof value === "string") {
      const stringId = stringIds.get(value);
      return stringId === undefined ? value : `${stringRefPrefix}${stringId}`;
    }
    if (Array.isArray(value)) return value.map(compactValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, compactValue(child)]),
      );
    }
    return value;
  }

  function intern(child: BrandIconNode | string): number | string {
    if (typeof child === "string") return compactValue(child) as string;
    const children = child.children.map(intern);
    const props = compactValue(child.props) as Record<string, unknown>;
    const key = JSON.stringify([child.type, props, children]);
    const existing = nodeIds.get(key);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push([child.type, props, children]);
    nodeIds.set(key, id);
    return id;
  }

  const compacted: CompactBrandIconVariants["variants"] = {};
  for (const [name, variant] of Object.entries(variants)) {
    compacted[name] = {
      ...(variant.viewBox === undefined ? {} : { viewBox: variant.viewBox }),
      ...(variant.fill === undefined ? {} : { fill: variant.fill }),
      ...(variant.stroke === undefined ? {} : { stroke: variant.stroke }),
      children: variant.childNodes.map(intern),
    };
  }
  return { nodes, strings, stringRefPrefix, variants: compacted };
}

/** Reconstruct the generated package shape; exported for losslessness checks. */
export function expandBrandIconVariants(
  compacted: CompactBrandIconVariants,
): BrandIconVariants {
  function expandValue(value: unknown): unknown {
    if (
      typeof value === "string" &&
      value.startsWith(compacted.stringRefPrefix)
    ) {
      const suffix = value.slice(compacted.stringRefPrefix.length);
      if (/^\d+$/.test(suffix)) {
        const original = compacted.strings[Number(suffix)];
        if (original !== undefined) return original;
      }
    }
    if (Array.isArray(value)) return value.map(expandValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, expandValue(child)]),
      );
    }
    return value;
  }

  function expand(child: number | string): BrandIconNode | string {
    if (typeof child === "string") return expandValue(child) as string;
    const node = compacted.nodes[child];
    if (!node)
      throw new Error(`Invalid compact brand icon node reference: ${child}`);
    return {
      type: node[0],
      props: expandValue(node[1]) as Record<string, unknown>,
      children: node[2].map(expand),
    };
  }

  const variants: BrandIconVariants = {};
  for (const [name, variant] of Object.entries(compacted.variants)) {
    variants[name] = {
      ...(variant.viewBox === undefined ? {} : { viewBox: variant.viewBox }),
      ...(variant.fill === undefined ? {} : { fill: variant.fill }),
      ...(variant.stroke === undefined ? {} : { stroke: variant.stroke }),
      childNodes: variant.children.map(expand),
    };
  }
  return variants;
}

/** Parse the generated JSON literal without executing any package code. */
export function extractBrandIconVariants(source: string): BrandIconVariants {
  const marker = "const _variants = ";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing generated _variants JSON literal");
  const jsonStart = start + marker.length;
  const end = source.indexOf(";\n\n", jsonStart);
  if (end < 0) throw new Error("Unterminated generated _variants JSON literal");
  const parsed: unknown = JSON.parse(source.slice(jsonStart, end));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Generated _variants must be an object");
  }
  return parsed as BrandIconVariants;
}

/** Vite transform that removes per-icon renderer duplication and interns nodes. */
export function compactBrandIcons(
  rendererPath = fileURLToPath(
    new URL(
      "../src/features/studio-engine/compact-brand-icon.ts",
      import.meta.url,
    ),
  ),
): Plugin {
  return {
    name: "savia-compact-brand-icons",
    enforce: "pre",
    transform(source, id) {
      const cleanId = id.split("?", 1)[0];
      if (
        !cleanId.includes("/node_modules/@thesvg/react/dist/") ||
        !cleanId.endsWith(".js") ||
        cleanId.endsWith("/index.js")
      ) {
        return null;
      }

      let compacted: CompactBrandIconVariants;
      try {
        compacted = compactBrandIconVariants(extractBrandIconVariants(source));
      } catch {
        return null;
      }

      const name = source.match(/\.displayName\s*=\s*'([^']+)'/)?.[1];
      if (!name) return null;
      const namespaceIds = source.includes("function _ns(props, p)");
      const config = JSON.stringify({ ...compacted, namespaceIds });
      return {
        code: `import { createBrandIconComponent } from ${JSON.stringify(rendererPath)};\nexport default createBrandIconComponent(${JSON.stringify(name)}, ${config});`,
        map: null,
      };
    },
  };
}
