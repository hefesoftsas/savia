import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";
import type { ExtensionSettingsDefinition } from "@savia/studio-shared/extension-runtime";
import { ExtensionSettingsRepository } from "../src/extension-settings";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;

const definition: ExtensionSettingsDefinition = {
  extensionId: "inventory.sync",
  schema: z.object({ enabled: z.boolean() }).strict(),
  defaults: { enabled: true },
};

const key = {
  tenantId: "tenant-a",
  extensionId: "inventory.sync",
};

async function applyMigrations() {
  for (const name of readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    for (const statement of readFileSync(`migrations/${name}`, "utf8")
      .split(/;(?!(?:\s*END\b))/i)
      .filter((value) => value.trim()))
      await platform.env.DB.prepare(statement).run();
}

function repository(extensionActive = true) {
  return new ExtensionSettingsRepository(platform.env.DB, {
    isExtensionActive: async () => extensionActive,
    now: () => new Date("2026-09-16T00:00:00.000Z"),
  });
}

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  await applyMigrations();
});

beforeEach(async () => {
  await platform.env.DB.exec("DELETE FROM extension_settings");
});

afterAll(async () => {
  await platform?.dispose();
});

describe("extension settings", () => {
  it("returns defaults until a tenant writes a validated versioned override", async () => {
    const settings = repository();

    await expect(settings.get(key, definition)).resolves.toEqual({
      value: { enabled: true },
      version: 0,
      updatedAt: null,
    });
    await expect(
      settings.replace(
        { ...key, principalId: "admin-a", version: 0 },
        definition,
        { enabled: false },
      ),
    ).resolves.toEqual({
      value: { enabled: false },
      version: 1,
      updatedAt: "2026-09-16T00:00:00.000Z",
    });
  });

  it("isolates tenant overrides and rejects stale writers", async () => {
    const settings = repository();
    await settings.replace(
      { ...key, principalId: "admin-a", version: 0 },
      definition,
      { enabled: false },
    );

    await expect(
      settings.get({ ...key, tenantId: "tenant-b" }, definition),
    ).resolves.toMatchObject({ value: { enabled: true }, version: 0 });
    await expect(
      settings.replace(
        { ...key, principalId: "admin-a", version: 0 },
        definition,
        { enabled: true },
      ),
    ).rejects.toMatchObject({ code: "EXTENSION_SETTINGS_VERSION_CONFLICT" });
  });

  it("rejects reads and writes for an inactive extension", async () => {
    const settings = repository(false);

    await expect(settings.get(key, definition)).rejects.toMatchObject({
      code: "EXTENSION_DISABLED",
    });
    await expect(
      settings.replace(
        { ...key, principalId: "admin-a", version: 0 },
        definition,
        { enabled: false },
      ),
    ).rejects.toMatchObject({ code: "EXTENSION_DISABLED" });
  });
});
