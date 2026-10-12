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
