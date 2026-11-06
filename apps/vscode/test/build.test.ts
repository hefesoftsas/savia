import fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildLocalProject, type BuildDiagnostic } from "../src/build";
import { authoringFixture, testBundles } from "./authoring-fixtures";
let f: Awaited<ReturnType<typeof authoringFixture>> | undefined;
afterEach(async () => {
  await f?.dispose();
  f = undefined;
});
it("requires workspace trust and saves before reading the actual build inputs", async () => {
  f = await authoringFixture();
  let saves = 0;
  const diagnostics: BuildDiagnostic[][] = [];
  await expect(
    buildLocalProject(f.uri, f.connection.profile, await testBundles(), {
      isTrusted: () => false,
      saveAll: async () => {
        saves++;
        return true;
      },
      diagnostics: (items) => diagnostics.push(items),
    }),
  ).rejects.toThrow("trusted");
  expect(saves).toBe(0);
  const result = await buildLocalProject(
    f.uri,
    f.connection.profile,
    await testBundles(),
    {
      isTrusted: () => true,
      saveAll: async () => {
        saves++;
        await fs.writeFile(
          join(f!.root, "entry.tsx"),
          'export function render(el) { el.textContent="Saved before build"; }',
        );
        return true;
      },
      diagnostics: (items) => diagnostics.push(items),
    },
  );
  expect(result?.entryJs).toContain("Saved before build");
  expect(saves).toBe(1);
});
it("reports source compiler failures in Problems without changing local files", async () => {
  f = await authoringFixture();
  const invalid = "export function render( {";
  await fs.writeFile(join(f.root, "entry.tsx"), invalid);
  let diagnostics: BuildDiagnostic[] = [];
  await expect(
    buildLocalProject(f.uri, f.connection.profile, await testBundles(), {
      isTrusted: () => true,
      saveAll: async () => true,
      diagnostics: (items) => {
        diagnostics = items;
      },
    }),
  ).rejects.toThrow();
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].path).toBe("entry.tsx");
  expect(await fs.readFile(join(f.root, "entry.tsx"), "utf8")).toBe(invalid);
});
it("does not build or write an artifact after a save cancellation", async () => {
  f = await authoringFixture();
  expect(
    await buildLocalProject(f.uri, f.connection.profile, await testBundles(), {
      isTrusted: () => true,
      saveAll: async () => false,
      diagnostics: () => {},
    }),
  ).toBeUndefined();
  await expect(fs.stat(join(f.root, ".savia/artifacts"))).rejects.toThrow();
});
