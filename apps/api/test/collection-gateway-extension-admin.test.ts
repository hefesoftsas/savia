import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  createStudioApp: vi.fn(),
  fetch: vi.fn(),
  connectionRepository: vi.fn(),
  settingsRepository: vi.fn(),
  disabledSolutionObjects: vi.fn(),
}));

vi.mock("@savia/studio-server/index", () => ({
  createStudioApp: gatewayMocks.createStudioApp,
}));
vi.mock("@savia/studio-server/extension-connections", () => ({
  ExtensionConnectionRepository: gatewayMocks.connectionRepository,
}));
vi.mock("@savia/studio-server/extension-settings", () => ({
  ExtensionSettingsRepository: gatewayMocks.settingsRepository,
}));
vi.mock("@savia/studio-server/extensions", () => ({
  isExtensionAvailable: vi.fn(),
}));
vi.mock("@savia/studio-server/solutions", () => ({
  disabledSolutionObjects: gatewayMocks.disabledSolutionObjects,
}));

import {
  canManageTenantExtensions,
  createCollectionGateway,
} from "../src/studio/collection-gateway";
import type { AppActor } from "../src/auth/types";

function actor(
  overrides: Pick<AppActor, "globalRoles" | "memberships">,
): AppActor {
  return {
    principal: {
      id: "principal-a",
      issuer: "test",
      subject: "principal-a",
      email: "principal@example.test",
      displayName: "Principal",
      isActive: true,
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("extension administration authorization", () => {
  beforeEach(() => {
    gatewayMocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    gatewayMocks.createStudioApp.mockReturnValue({ fetch: gatewayMocks.fetch });
    gatewayMocks.disabledSolutionObjects.mockResolvedValue(new Set());
  });

  it("admits platform and current-tenant administrators but not operators", () => {
    expect(
      canManageTenantExtensions(
        actor({
          globalRoles: [],
          memberships: [
            {
              id: "operator",
              principalId: "principal-a",
              agencyId: 101,
              tenantId: 101,
              role: "operator",
              isActive: true,
              createdAt: "2026-09-16T00:00:00.000Z",
              updatedAt: "2026-09-16T00:00:00.000Z",
            },
          ],
        }),
        "agency:101",
      ),
    ).toBe(false);
    expect(
      canManageTenantExtensions(
        actor({
          globalRoles: [],
          memberships: [
            {
              id: "admin",
              principalId: "principal-a",
              agencyId: 101,
              tenantId: 101,
              role: "tenant_admin",
              isActive: true,
              createdAt: "2026-09-16T00:00:00.000Z",
              updatedAt: "2026-09-16T00:00:00.000Z",
            },
          ],
        }),
        "agency:101",
      ),
    ).toBe(true);
    expect(
      canManageTenantExtensions(
        actor({ globalRoles: ["platform_admin"], memberships: [] }),
        "agency:101",
      ),
    ).toBe(true);
  });

  it("provides extension settings storage to the tenant CRM runtime", async () => {
    const db = {} as D1Database;
    const gateway = createCollectionGateway({
      db,
      files: {} as R2Bucket,
      tenant: "agency:101",
      actor: actor({ globalRoles: ["platform_admin"], memberships: [] }),
      seedObjects: [],
    });

    await gateway.fetch(new Request("https://crm.internal/api/health"));

    expect(gatewayMocks.settingsRepository).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ isExtensionActive: expect.any(Function) }),
    );
    expect(gatewayMocks.createStudioApp).toHaveBeenCalledWith(
      "agency:101",
      expect.objectContaining({
        settingsRepository: expect.anything(),
      }),
    );
  });

  it("forwards Savia Request to tenant ZIP actions in the Studio runtime", async () => {
    const saviaRequestService = { fetch: vi.fn() };
    const context = {
      db: {} as D1Database,
      files: {} as R2Bucket,
      tenant: "agency:101",
      actor: actor({ globalRoles: ["platform_admin"], memberships: [] }),
      seedObjects: [],
      saviaRequestService,
    };

    await createCollectionGateway(context).fetch(
      new Request("https://crm.internal/api/health"),
    );

    expect(gatewayMocks.createStudioApp).toHaveBeenCalledWith(
      "agency:101",
      expect.objectContaining({ saviaRequestService }),
    );
  });
});
