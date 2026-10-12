import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, expect, it } from "vitest";
let directory: string;
beforeAll(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "savia-vsix-"));
});
afterAll(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
it("packages a standalone VSIX with required commands and compiler assets and no credentials or workspace links", async () => {
  const stage = join(directory, "stage"),
    output = join(directory, "savia.vsix");
  execFileSync(process.execPath, ["scripts/build.mjs", "--stage", stage], {
    stdio: "pipe",
    env: { ...process.env, NODE_PATH: "" },
  });
  execFileSync(
    process.execPath,
    ["scripts/package.mjs", "--stage", stage, "--out", output],
    { stdio: "pipe" },
  );
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await fs.readFile(output)));
  const names = Object.keys(entries);
  expect(names).toContain("extension/dist/extension.cjs");
  expect(names).toContain("extension/assets/bundles.json");
  expect(names).toContain("extension/types/plugin.d.ts");
  expect(names).toContain("extension/assets/declarations.json");
  const manifest = JSON.parse(
    new TextDecoder().decode(entries["extension/package.json"]),
  );
  expect(manifest).toMatchObject({
    name: "savia-plugin-authoring",
    publisher: "savia",
    engines: { vscode: "^1.96.2" },
    main: "./dist/extension.cjs",
  });
  expect(
    manifest.contributes.commands.map((command: any) => command.command),
  ).toContain("savia.retrySharedPublication");
  expect(
    names.some((name) =>
      /node_modules|\.env|test\/|\.savia\/|infra\/secrets/.test(name),
    ),
  ).toBe(false);
  const text = new TextDecoder().decode(
    entries["extension/dist/extension.cjs"],
  );
  expect(text).not.toContain("fixture-key");
  expect(text).not.toContain("private-publisher");
  expect(await fs.readFile(output + ".sha256", "utf8")).toMatch(
    /^[a-f0-9]{64} /,
  );
}, 60000);
it("refuses to package missing pinned runtime assets", async () => {
  const stage = join(directory, "broken");
  execFileSync(process.execPath, ["scripts/build.mjs", "--stage", stage], {
    stdio: "pipe",
    env: { ...process.env, NODE_PATH: "" },
  });
  await fs.unlink(join(stage, "assets/bundles.json"));
  expect(() =>
    execFileSync(
      process.execPath,
      [
        "scripts/package.mjs",
        "--stage",
        stage,
        "--out",
        join(directory, "broken.vsix"),
      ],
      { stdio: "pipe" },
    ),
  ).toThrow();
});

it("resolves supported library types in an isolated authored checkout", async () => {
  const stage = join(directory, "typed-stage"),
    root = join(directory, "typed-project");
  execFileSync(process.execPath, ["scripts/build.mjs", "--stage", stage], {
    stdio: "pipe",
    env: { ...process.env, NODE_PATH: "" },
  });
  const declarations = JSON.parse(
    await fs.readFile(join(stage, "assets/declarations.json"), "utf8"),
  );
  const { checkoutProject } = await import("../src/checkout");
  const { initial } = await import("./authoring-fixtures");
  await fs.mkdir(root);
  await checkoutProject(
    { scheme: "file", fsPath: root },
    initial,
    {
      id: "a".repeat(64),
      origin: "https://example.com",
      tenantId: 12,
      principalId: "author",
    },
    declarations,
  );
  await fs.writeFile(
    join(root, "entry.tsx"),
    `import React from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
export function render(el: HTMLElement) {
 const value: string=z.string().parse("Hello");
 // @ts-expect-error Zod output is typed, not any
 const invalid: number = z.string().parse("Hello");
 const node: React.ReactNode=<span>{value}</span>;
 createRoot(el).render(node);
 void PDFDocument.create();
}`,
  );
  const ts = await import("typescript");
  const config = ts.readConfigFile(
    join(root, "tsconfig.json"),
    ts.sys.readFile,
  );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(
    diagnostics.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    ),
  ).toEqual([]);
}, 60000);
