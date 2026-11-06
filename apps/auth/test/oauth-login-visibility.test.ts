import { describe, expect, it } from "vitest";
import { oauthPageResponse } from "../src/oauth-pages";

function visibilityHarness(providerResult: unknown) {
  const socialLogin = {
    hidden: true,
    dataset: {} as Record<string, string>,
    querySelectorAll: () => [] as Array<Record<string, unknown>>,
  };
  const loginPanel = { hidden: false };
  const ssoPanel = {
    hidden: true,
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
  let openSSO!: () => void;
  const ssoTrigger = {
    hidden: true,
    dataset: { oauthShow: "sso" },
    addEventListener: (_: string, listener: () => void) => {
      openSSO = listener;
    },
  };
  const button = {
    hidden: true,
    disabled: false,
    dataset: { socialProvider: "google" },
    addEventListener: () => {},
  };
  socialLogin.querySelectorAll = () => [button];
  const targets: Record<string, unknown> = {
    "[data-social-login]": socialLogin,
    '[data-oauth-form="sign-in"]': loginPanel,
    '[data-oauth-show="sso"]': ssoTrigger,
    '[data-oauth-panel="sso"]': ssoPanel,
  };
  const fetchCalls: string[] = [];
  const scriptPromise = oauthPageResponse(
    new Request("https://tenant.example.test/api/auth/oauth-ui.js"),
  )!.text();

  return scriptPromise.then((script) => {
    new Function("window", "document", "fetch", script)(
      { location: { search: "" } },
      {
        querySelector: (selector: string) => targets[selector] ?? null,
        querySelectorAll: (selector: string) =>
          selector === "[data-oauth-show]" ? [ssoTrigger] : [],
        addEventListener: () => {},
      },
      (url: string) => {
        fetchCalls.push(url);
        if (providerResult instanceof Error)
          return Promise.reject(providerResult);
        return Promise.resolve({
          ok: true,
          json: async () => providerResult,
        });
      },
    );
    return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => ({
      socialLogin,
      loginPanel,
      ssoPanel,
      ssoTrigger,
      button,
      fetchCalls,
      openSSO,
    }));
  });
}

describe("tenant login method visibility", () => {
  it("shows only tenant-enabled providers and the active tenant SSO action", async () => {
    const h = await visibilityHarness({
      providers: ["google"],
      ssoEnabled: true,
    });

    expect(h.fetchCalls).toContain("/api/auth/savia-social/providers");
    expect(h.button.hidden).toBe(false);
    expect(h.socialLogin.hidden).toBe(false);
    expect(h.ssoTrigger.hidden).toBe(false);
    h.openSSO();
    expect(h.ssoPanel.hidden).toBe(false);
  });

  it("keeps social and SSO controls hidden when the tenant has no enabled methods", async () => {
    const h = await visibilityHarness({ providers: [], ssoEnabled: false });

    expect(h.button.hidden).toBe(true);
    expect(h.socialLogin.hidden).toBe(true);
    expect(h.ssoTrigger.hidden).toBe(true);
    h.openSSO();
    expect(h.ssoPanel.hidden).toBe(true);
  });

  it("allows SSO for an SSO-only tenant without showing social buttons", async () => {
    const h = await visibilityHarness({ providers: [], ssoEnabled: true });

    expect(h.socialLogin.hidden).toBe(true);
    expect(h.ssoTrigger.hidden).toBe(false);
    h.openSSO();
    expect(h.ssoPanel.hidden).toBe(false);
  });

  it("hides both login methods when discovery fails", async () => {
    const h = await visibilityHarness(new Error("discovery failed"));

    expect(h.socialLogin.hidden).toBe(true);
    expect(h.ssoTrigger.hidden).toBe(true);
    h.openSSO();
    expect(h.ssoPanel.hidden).toBe(true);
  });
});
