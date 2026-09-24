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

function compareSemver(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

const packageDirFor = {
  portfolio: "insurance-portfolio-dashboard",
};

describe("ports del store", () => {
  it("hay ports generados para el grupo portable", () => {
    assert.ok(
      ports.length >= 17,
      `se esperaban al menos 17 ports, hay ${ports.length}: ${ports.join(", ")}`,
    );
  });

  it("valida todos los ports con los schemas reales del contrato", () => {
    const checker = join(
      mkdtempSync(join(tmpdir(), "savia-port-check-")),
      "check.cjs",
    );
    try {
      execFileSync(
        join(root, "apps/admin/node_modules/.bin/esbuild"),
        [
          join(root, "scripts/store-port-check.ts"),
          "--bundle",
          "--platform=node",
          "--format=cjs",
          `--outfile=${checker}`,
          "--log-level=error",
        ],
        {
          cwd: root,
          stdio: "pipe",
          timeout: 180000,
          env: {
            ...process.env,
            NODE_PATH: [
              join(root, "apps/admin/node_modules"),
              join(root, "node_modules"),
            ].join(":"),
          },
        },
      );
      for (const port of ports) {
        const result = JSON.parse(
          execFileSync("node", [checker, join(portsDir, port)], {
            cwd: root,
            encoding: "utf8",
            timeout: 60000,
          }),
        );
        assert.deepEqual(
          result.errors,
          [],
          `${port}: ${result.errors.join("; ")}`,
        );
        // Continuidad de versiones: mismo id migra hacia arriba.
        if (!result.id.startsWith("custom.")) {
          const packageDir = packageDirFor[port] ?? `insurance-${port}`;
          const release = JSON.parse(
            readFileSync(
              join(root, "packages", packageDir, "savia-extension.json"),
              "utf8",
            ),
          );
          assert.equal(
            result.id,
            release.id,
            `${port}: el id cambió respecto al release`,
          );
          assert.ok(
            compareSemver(result.version, release.version) > 0,
            `${port}: ${result.version} debe superar a ${release.version}`,
          );
        }
      }
    } finally {
      rmSync(join(checker, ".."), { force: true, recursive: true });
    }
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
