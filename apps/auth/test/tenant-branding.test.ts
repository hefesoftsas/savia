import { env } from "cloudflare:workers";
import authWorker from "../src/index";
import { describe, expect, it } from "vitest";
import {
  oauthPageResponse,
  tenantBrandingFromHeader,
} from "../src/oauth-pages";
import type { TenantBranding } from "@savia/tenant-host/branding";

const branding: TenantBranding = {
  displayName: "Seguros Bogotá",
  loginTitle: "Bienvenido a Seguros",
  loginDescription: "Tu equipo, conectado.",
  primaryColor: "#ffffff",
  accentColor: "#123456",
  logoUrl:
    "/api/public/tenant-branding/assets/1/12345678-1234-4234-8234-123456789012",
  coverUrl:
    "/api/public/tenant-branding/assets/1/12345678-1234-4234-8234-123456789013",
  version: 1,
};
const request = (path: string) =>
  new Request(`https://example.com/api/auth/${path}`);
describe("tenant identity on OAuth surfaces", () => {
  it("renders the default login video reel muted with a pause control", async () => {
    const html = await oauthPageResponse(request("login"))!.text();

    expect(html).toContain('src="/login/savia-platform-01.mp4"');
    expect(html).toContain('src="/login/savia-platform-02.mp4"');
    expect(html).toContain('aria-label="Pausar vídeos"');
    expect(html).toMatch(
      /<video[^>]*autoPlay=""[^>]*muted=""[^>]*playsInline=""/,
    );
    expect(html).toContain("data-oauth-login-reel");
  });

  it("passes the internal tenant header through worker HTML and stylesheet routes", async () => {
    const headers = {
      "x-savia-tenant-branding": encodeURIComponent(JSON.stringify(branding)),
    };
    for (const [path, expected] of [
      ["login", branding.displayName],
      ["oauth-ui.css", "--aside: #123456"],
    ]) {
      const response = await authWorker.fetch(
        new Request(`http://127.0.0.1:8787/api/auth/${path}`, { headers }),
        env,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(expected);
    }
  });
  it("renders identity and assets on the server without weakening CSP", async () => {
    const response = oauthPageResponse(request("login"), { branding })!;
    const html = await response.text();
    for (const value of [
      branding.displayName,
      branding.loginTitle,
      branding.loginDescription,
      branding.logoUrl!,
      branding.coverUrl!,
    ])
      expect(html).toContain(value);
    expect(html).toContain('data-oauth-form="sign-in"');
    expect(html).toContain('data-tenant-branding="true"');
    expect(html).not.toContain('style="');
    expect(response.headers.get("content-security-policy")).toContain(
      "form-action 'self'",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "unsafe-inline",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("escapes tenant text in document title and React markup", async () => {
    const html = await oauthPageResponse(request("login"), {
      branding: {
        ...branding,
        displayName: "</title><script>alert(1)</script>",
        loginTitle: "<script>alert(2)</script>",
      },
    })!.text();
    expect(html).not.toContain("<script>alert(");
    expect(html).toContain("&lt;script");
  });
  it("decodes the internal header and rejects malformed or unsafe values", () => {
    expect(
      tenantBrandingFromHeader(encodeURIComponent(JSON.stringify(branding))),
    ).toEqual(branding);
    for (const input of [
      null,
      "%zz",
      "{}",
      encodeURIComponent(
        JSON.stringify({ ...branding, primaryColor: "red; color: red" }),
      ),
      encodeURIComponent(
        JSON.stringify({ ...branding, logoUrl: "https://evil.example/logo" }),
      ),
    ])
      expect(tenantBrandingFromHeader(input)).toBeUndefined();
  });
  it("retains the default identity when configuration is invalid", async () => {
    const html = await oauthPageResponse(request("login"), {
      branding: { ...branding, primaryColor: "invalid" },
    })!.text();
    expect(html).toContain("Acceso a Savia");
    expect(html).not.toContain("data-tenant-branding");
  });
  it("scopes validated theme colors and chooses readable button text", async () => {
    const css = await oauthPageResponse(request("oauth-ui.css"), {
      branding,
    })!.text();
    expect(css).toContain(".oauth-screen[data-tenant-branding]");
    expect(css).toContain("--primary: #ffffff");
    expect(css).toContain("--primary-foreground: #000000");
    expect(css).toContain("--aside: #123456");
  });
  it("preserves MFA and consent forms and rejects POST page rendering", async () => {
    for (const [path, form] of [
      ["mfa-enroll", "enable-totp"],
      ["consent", "consent"],
    ]) {
      const html = await oauthPageResponse(request(path), { branding })!.text();
      expect(html).toContain(`data-oauth-form="${form}"`);
      expect(html).toContain(branding.displayName);
    }
    expect(
      oauthPageResponse(new Request(request("login"), { method: "POST" }), {
        branding,
      }),
    ).toBeUndefined();
  });
});
