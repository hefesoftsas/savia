import { describe, expect, it, vi } from "vitest";
import { tenantSocialResponse } from "../src/social-sign-in";

function fixture() {
  const settings = {
    tenantId: 7,
    active: true,
    googleEnabled: true,
    microsoftEnabled: false,
    chatgptEnabled: false,
  };
  const sso = {
    saviaTenantId: 7,
    saviaEnabled: true,
    saviaTenantActive: true,
    saviaSSOOnly: false,
    samlConfig: "{}",
  };
  const records: Record<string, unknown> = {
    tenantSocialSettings: settings,
    ssoProvider: sso,
    tenantAuthState: { tenantId: 7, active: true },
  };
  const adapter: any = {
    findOne: vi.fn(async ({ model, where }: any) => {
      const record = records[model] as Record<string, unknown> | undefined;
      return record &&
        where.every(({ field, value }: any) => record[field] === value)
        ? record
        : null;
    }),
  };
  const environment: any = {
    SAVIA_INTERNAL_BRIDGE_KEY: "methods-bridge",
    SAVIA_GOOGLE_CLIENT_ID: "google-id",
    SAVIA_GOOGLE_CLIENT_SECRET: "google-secret",
    SAVIA_MICROSOFT_CLIENT_ID: "microsoft-id",
    SAVIA_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  };
  const request = (
    headers: Record<string, string> = {
      "x-savia-bridge-key": "methods-bridge",
      "x-savia-social-tenant-id": "7",
    },
  ) =>
    new Request("https://team.example.test/api/auth/savia-social/providers", {
      headers,
    });
  const discover = async (req = request()) => {
    const response = await tenantSocialResponse(req, environment, adapter);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    return response!.json();
  };
  return { settings, sso, records, adapter, environment, request, discover };
}

describe("tenant login method discovery", () => {
  it("returns only enabled tenant providers with deployment credentials and configured SSO", async () => {
    const f = fixture();
    expect(await f.discover()).toEqual({
      providers: ["google"],
      ssoEnabled: true,
    });
    f.settings.googleEnabled = false;
    f.settings.microsoftEnabled = true;
    expect(await f.discover()).toEqual({
      providers: ["microsoft"],
      ssoEnabled: true,
    });
    delete f.environment.SAVIA_MICROSOFT_CLIENT_ID;
    delete f.environment.SAVIA_MICROSOFT_CLIENT_SECRET;
    expect(await f.discover()).toEqual({ providers: [], ssoEnabled: true });
  });

  it("hides all methods for absent, forged, invalid and mismatched tenant context", async () => {
    const f = fixture();
    for (const headers of [
      {},
      { "x-savia-social-tenant-id": "7" },
      { "x-savia-social-tenant-id": "7", "x-savia-bridge-key": "forged" },
      {
        "x-savia-social-tenant-id": "0",
        "x-savia-bridge-key": "methods-bridge",
      },
      {
        "x-savia-social-tenant-id": "8",
        "x-savia-bridge-key": "methods-bridge",
      },
    ])
      expect(await f.discover(f.request(headers))).toEqual({
        providers: [],
        ssoEnabled: false,
      });
  });

  it("requires a separate ChatGPT tenant opt-in even with deployment credentials", async () => {
    const f = fixture();
    f.environment.SAVIA_CHATGPT_CLIENT_ID = "oaiapp_methods_fixture";
    expect(await f.discover()).toEqual({
      providers: ["google"],
      ssoEnabled: true,
    });
    f.settings.chatgptEnabled = true;
    expect(await f.discover()).toEqual({
      providers: ["google", "chatgpt"],
      ssoEnabled: true,
    });
    delete f.environment.SAVIA_CHATGPT_CLIENT_ID;
    expect(await f.discover()).toEqual({
      providers: ["google"],
      ssoEnabled: true,
    });
  });

  it("keeps SSO independent of social settings and hides disabled or unconfigured SSO", async () => {
    const f = fixture();
    delete f.records.tenantSocialSettings;
    expect(await f.discover()).toEqual({ providers: [], ssoEnabled: true });
    for (const patch of [
      { saviaEnabled: false },
      { saviaTenantActive: false },
      { samlConfig: null },
    ]) {
      f.records.ssoProvider = { ...f.sso, ...patch };
      expect(await f.discover()).toEqual({ providers: [], ssoEnabled: false });
    }
  });

  it("hides social providers under SSO-only policy or inactive social settings", async () => {
    const f = fixture();
    f.sso.saviaSSOOnly = true;
    expect(await f.discover()).toEqual({ providers: [], ssoEnabled: true });
    f.sso.saviaSSOOnly = false;
    f.settings.active = false;
    expect(await f.discover()).toEqual({ providers: [], ssoEnabled: true });
  });

  it("hides every method when the tenant has an inactive tombstone", async () => {
    const f = fixture();
    f.records.tenantAuthState = { tenantId: 7, active: false };
    expect(await f.discover()).toEqual({ providers: [], ssoEnabled: false });
  });
});
