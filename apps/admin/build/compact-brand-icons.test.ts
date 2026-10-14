import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  compactBrandIcons,
  compactBrandIconVariants,
  expandBrandIconVariants,
  extractBrandIconVariants,
} from "./compact-brand-icons";

const require = createRequire(import.meta.url);
const catalogDirectory = join(dirname(require.resolve("@thesvg/react")), "");

it("round-trips every installed icon variant without changing SVG data", () => {
  const files = readdirSync(catalogDirectory).filter(
    (file) =>
      file.endsWith(".js") && file !== "index.js" && file !== "types.js",
  );
  expect(files.length).toBeGreaterThan(6_000);
  const plugin = compactBrandIcons(
    resolve("src/features/studio-engine/compact-brand-icon.ts"),
  );
  let sourceBytes = 0;
  let compactBytes = 0;

  for (const file of files) {
    const source = readFileSync(join(catalogDirectory, file), "utf8");
    sourceBytes += Buffer.byteLength(source);
    const variants = extractBrandIconVariants(source);
    expect(expandBrandIconVariants(compactBrandIconVariants(variants))).toEqual(
      variants,
    );
    const transformed = plugin.transform?.call(
      {} as never,
      source,
      join(catalogDirectory, file),
    );
    const code =
      typeof transformed === "string" ? transformed : transformed?.code;
    expect(code, file).toBeTruthy();
    compactBytes += Buffer.byteLength(code ?? "");
  }
  expect(compactBytes).toBeLessThan(sourceBytes);
});

it("extracts JSON config without evaluating module source", () => {
  const source = `const _variants = {"default":{"childNodes":["safe"]}};\n\nthrow new Error("must not execute");`;
  expect(extractBrandIconVariants(source)).toEqual({
    default: { childNodes: ["safe"] },
  });
});

it("interns repeated long SVG strings across nodes and nested style props", () => {
  const geometry = "M10 20 C30 40 50 60 70 80 C90 100 110 120 130 140 Z";
  const variants = {
    default: {
      childNodes: [
        { type: "path", props: { d: geometry, fill: "red" }, children: [] },
        {
          type: "path",
          props: { d: geometry, style: { clipPath: `path('${geometry}')` } },
          children: [],
        },
      ],
    },
  };
  const compacted = compactBrandIconVariants(variants);

  expect(compacted.strings).toContain(geometry);
  expect(expandBrandIconVariants(compacted)).toEqual(variants);
});

it("replaces an individual generated module with compact shared-renderer data", () => {
  const plugin = compactBrandIcons(
    resolve("src/features/studio-engine/compact-brand-icon.ts"),
  );
  const source = `const _variants = {"default":{"viewBox":"0 0 1 1","childNodes":[{"type":"path","props":{"d":"M0 0h1"},"children":[]}]}};\n\nconst Example = forwardRef(\n  function Example({ variant = 'default', viewBox, ...props }, ref) { return null; }\n);\nExample.displayName = 'Example';\nexport default Example;`;
  const result = plugin.transform?.call(
    {} as never,
    source,
    "/repo/node_modules/@thesvg/react/dist/example.js",
  );
  const code = typeof result === "string" ? result : result?.code;

  expect(result).toBeTruthy();
  expect(code).toContain('createBrandIconComponent("Example"');
  expect(code).not.toContain("forwardRef(");
  expect(
    plugin.transform?.call(
      {} as never,
      source,
      "/repo/node_modules/@thesvg/react/dist/index.js",
    ),
  ).toBeNull();
});
