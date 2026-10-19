import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("production application deployment and backup workflows are absent", async () => {
  for (const name of [
    "deploy-cloudflare.yml",
    "backup-production.yml",
    "check-production-backups.yml",
  ]) {
    await assert.rejects(
      access(new URL(`../../.github/workflows/${name}`, import.meta.url)),
      { code: "ENOENT" },
    );
  }
});

test("the remaining preview release owns its backup gate before deploying writers", async () => {
  const source = await readFile(
    new URL("../../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  const owner = source.indexOf("- name: Deploy savia backup coordinator");
  assert.ok(owner >= 0, "dedicated preview namespace owner is missing");
  const pause = source.indexOf(
    "- name: Pause Savia writes for persistence backup",
  );
  assert.ok(
    pause >= 0 && owner < pause,
    "the pause deployment already requires the coordinator namespace",
  );
  for (const dependent of [
    "Deploy savia-agencies",
    "Deploy savia-auth",
    "Deploy private Savia request",
    "Deploy private Savia connectors",
  ])
    assert.ok(
      owner < source.indexOf(`- name: ${dependent}`),
      `${dependent} needs the dedicated namespace first`,
    );
});
