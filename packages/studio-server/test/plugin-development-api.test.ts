import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  developmentFixture,
  readAccess,
  fullAccess,
  seedDevelopmentArtifact,
} from "./plugin-development-fixtures";
let f: Awaited<ReturnType<typeof developmentFixture>>;
beforeAll(async () => {
  f = await developmentFixture();
  await seedDevelopmentArtifact(f.db);
  await seedDevelopmentArtifact(f.db, "tenant:13", "9.0.0");
});
afterAll(async () => {
  await f?.dispose();
});
describe("native plugin development API", () => {
  it("returns authenticated identity and limits destinations to scopes and server configuration", async () => {
    for (const [access, registry, destinations] of [
      [readAccess, undefined, []],
      [fullAccess, undefined, ["tenant"]],
      [
        fullAccess,
        {
          url: "https://registry.test",
          token: "reader",
          publishToken: "publisher-secret",
        },
        ["tenant", "shared"],
      ],
    ] as const) {
      const response = await f.request("/capabilities", {
        pluginDevelopmentAccess: access,
        pluginRegistry: registry,
        canManageExtension: () => true,
      } as any);
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toMatchObject({
        schemaVersion: 1,
        compilerVersion: 1,
        tenantId: 12,
        principalId: "author",
        workspaceLabel: "Workspace 12",
        destinations,
      });
      expect(JSON.stringify(body)).not.toContain("publisher-secret");
    }
  });
  it("exports bounded tenant metadata without source files or other tenants", async () => {
    const response = await f.request("/catalog", {
      pluginDevelopmentAccess: readAccess,
      canManageExtension: () => true,
    } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        pluginId: "custom.example",
        label: "Example",
        head: { version: "1.0.0", sha256: "a".repeat(64) },
        installedVersion: null,
        versions: [
          {
            version: "1.0.0",
            sha256: "a".repeat(64),
            createdAt: "2026-10-12T00:00:00Z",
            authored: false,
          },
        ],
      },
    ]);
  });
  it("requires current management permission on every request", async () => {
    let allowed = true;
    const options = {
      pluginDevelopmentAccess: readAccess,
      canManageExtension: () => allowed,
    };
    expect((await f.request("/capabilities", options as any)).status).toBe(200);
    allowed = false;
    for (const path of [
      "/capabilities",
      "/catalog",
      "/custom.example/checkout?version=1.0.0",
    ])
      expect((await f.request(path, options as any)).status).toBe(403);
  });
  it("keeps routes unavailable without access and denies publish-only source access", async () => {
    expect(
      (await f.request("/capabilities", { canManageExtension: () => true }))
        .status,
    ).toBe(404);
    const options = {
      pluginDevelopmentAccess: { ...readAccess, read: false, publish: true },
      canManageExtension: () => true,
    };
    for (const path of ["/catalog", "/custom.example/checkout?version=1.0.0"])
      expect((await f.request(path, options as any)).status).toBe(403);
    expect(
      (
        await f.request(
          "/custom.example/publish",
          {
            pluginDevelopmentAccess: readAccess,
            canManageExtension: () => true,
          } as any,
          { method: "POST" },
        )
      ).status,
    ).toBe(403);
  });
});
