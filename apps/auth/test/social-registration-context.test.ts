import { describe, expect, it } from "vitest";
import {
  beginSocialRegistration,
  readSocialRegistration,
} from "../src/social-registration-context";

function fixture() {
  const records = new Map<string, any>();
  const settings = {
    tenantId: 4,
    active: true,
    googleEnabled: true,
    microsoftEnabled: true,
    allowRegistration: true,
    revision: "r1",
  };
  const adapter: any = {
    findOne: async ({ model, where }: any) =>
      model === "tenantSocialSettings"
        ? settings
        : model === "verification"
          ? records.get(where[0].value)
          : null,
    findMany: async () => [],
    create: async ({ data }: any) => {
      records.set(data.identifier, data);
      return data;
    },
    delete: async ({ where }: any) => records.delete(where[0].value),
  };
  const environment: any = { SAVIA_INTERNAL_BRIDGE_KEY: "test-bridge" };
  const request = (trusted = true) =>
    new Request(
      "https://savia-team.savia-preview.hefesoft.com/api/auth/sign-in/social",
      {
        headers: trusted
          ? {
              "x-savia-bridge-key": "test-bridge",
              "x-savia-social-tenant-id": "4",
            }
          : {},
      },
    );
  return { adapter, settings, environment, request, records };
}
describe("trusted social registration context", () => {
  it("rejects untrusted context and disabled registration", async () => {
    const f = fixture();
    expect(
      await beginSocialRegistration(
        f.request(false),
        "google",
        f.environment,
        f.adapter,
      ),
    ).toBeNull();
    f.settings.allowRegistration = false;
    expect(
      await beginSocialRegistration(
        f.request(),
        "google",
        f.environment,
        f.adapter,
      ),
    ).toBeNull();
    expect(f.records.size).toBe(0);
  });
  it("recovers a canonical callback only from server state and rechecks policy", async () => {
    const f = fixture();
    const attempt = await beginSocialRegistration(
      f.request(),
      "google",
      f.environment,
      f.adapter,
    );
    expect(attempt?.tenantId).toBe(4);
    expect(
      await readSocialRegistration(
        f.adapter,
        { additionalData: { socialAttemptId: attempt!.attemptId } },
        "google",
      ),
    ).toBeNull();
    const state = {
      callbackURL:
        "https://savia-team.savia-preview.hefesoft.com/api/auth/sso-complete",
      serverContext: { socialAttemptId: attempt!.attemptId },
    };
    expect(
      await readSocialRegistration(f.adapter, state, "google"),
    ).toMatchObject({ tenantId: 4, revision: "r1" });
    expect(
      await readSocialRegistration(f.adapter, state, "microsoft"),
    ).toBeNull();
    await expect(
      readSocialRegistration(
        f.adapter,
        {
          ...state,
          callbackURL:
            "https://other.savia-preview.hefesoft.com/api/auth/sso-complete",
        },
        "google",
      ),
    ).rejects.toThrow();
    f.settings.revision = "r2";
    await expect(
      readSocialRegistration(f.adapter, state, "google"),
    ).rejects.toThrow();
  });
  it("rejects expired attempts and inactive tenants", async () => {
    const f = fixture();
    const attempt = await beginSocialRegistration(
      f.request(),
      "google",
      f.environment,
      f.adapter,
    );
    const state = {
      callbackURL:
        "https://savia-team.savia-preview.hefesoft.com/api/auth/sso-complete",
      serverContext: { socialAttemptId: attempt!.attemptId },
    };
    f.records.values().next().value.expiresAt = new Date(0);
    await expect(
      readSocialRegistration(f.adapter, state, "google"),
    ).rejects.toThrow();
    f.settings.active = false;
    expect(
      await beginSocialRegistration(
        f.request(),
        "google",
        f.environment,
        f.adapter,
      ),
    ).toBeNull();
  });
});
