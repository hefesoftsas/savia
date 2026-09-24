import { describe, expect, it } from "vitest";
import {
  signPluginEntryGrant,
  verifyPluginEntryGrant,
} from "../src/plugin-entry-grant";

describe("ZIP plugin entry grants", () => {
  it("accepts only the signed tenant, plugin and version before expiry", async () => {
    const now = Date.now();
    const grant = {
      tenantId: "domain:platform",
      pluginId: "insurance.quotes",
      version: "1.3.1",
      expiresAt: now + 60_000,
    };
    const signature = await signPluginEntryGrant("local-secret", grant);
    expect(
      await verifyPluginEntryGrant("local-secret", grant, signature, now),
    ).toBe(true);
    expect(
      await verifyPluginEntryGrant(
        "local-secret",
        { ...grant, tenantId: "agency:101" },
        signature,
        now,
      ),
    ).toBe(false);
    expect(
      await verifyPluginEntryGrant(
        "local-secret",
        { ...grant, version: "1.3.0" },
        signature,
        now,
      ),
    ).toBe(false);
    expect(
      await verifyPluginEntryGrant(
        "local-secret",
        grant,
        signature,
        grant.expiresAt,
      ),
    ).toBe(false);
    expect(
      await verifyPluginEntryGrant("other-secret", grant, signature, now),
    ).toBe(false);
    const longGrant = { ...grant, expiresAt: now + 10 * 60_000 };
    expect(
      await verifyPluginEntryGrant(
        "local-secret",
        longGrant,
        await signPluginEntryGrant("local-secret", longGrant),
        now,
      ),
    ).toBe(false);
  });
});
