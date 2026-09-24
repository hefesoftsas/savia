import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const portsDir = join(root, "store-ports");
const ports = readdirSync(portsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("ports del store", () => {
  it("hay ports generados para el grupo portable", () => {
    assert.ok(
      ports.length >= 17,
      `se esperaban al menos 17 ports, hay ${ports.length}: ${ports.join(", ")}`,
    );
  });

  for (const port of ports) {
    it(`empaqueta ${port} con manifiesto y contrato válidos`, () => {
      const temporaryRoot = mkdtempSync(join(tmpdir(), "savia-port-test-"));
      try {
        const output = join(temporaryRoot, `${port}.store.zip`);
        execFileSync(
          "node",
          [
            "scripts/pack-store-plugin.mjs",
            `store-ports/${port}`,
            "--output",
            output,
          ],
          { cwd: root, stdio: "pipe", timeout: 180000 },
        );
        const names = execFileSync("unzip", ["-Z1", output], {
          cwd: root,
          encoding: "utf8",
        })
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        for (const required of ["savia-extension.json", "dist/plugin.js"]) {
          assert.ok(
            names.includes(required),
            `${port}: falta ${required} en ${names.join(", ")}`,
          );
        }
        const manifest = JSON.parse(
          execFileSync("unzip", ["-p", output, "savia-extension.json"], {
            cwd: root,
            encoding: "utf8",
          }),
        );
        assert.equal(manifest.format, "savia.extension");
        assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
        const entry = execFileSync("unzip", ["-p", output, "dist/plugin.js"], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
        assert.ok(
          Buffer.byteLength(entry) <= 2 * 1024 * 1024,
          `${port}: bundle supera 2 MB`,
        );
        assert.match(entry, /export[\s{]/);
      } finally {
        rmSync(temporaryRoot, { force: true, recursive: true });
      }
    });
  }
});
