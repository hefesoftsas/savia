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

function fakeAnimation() {
  const listeners = new Map<string, () => void>();
  return {
    totalFrames: 120,
    playCalls: 0,
    pauseCalls: 0,
    stoppedFrames: [] as number[],
    addEventListener(name: string, listener: () => void) {
      listeners.set(name, listener);
    },
    play() {
      this.playCalls += 1;
    },
    pause() {
      this.pauseCalls += 1;
    },
    goToAndStop(frame: number) {
      this.stoppedFrames.push(frame);
    },
    emit(name: string) {
      listeners.get(name)?.();
    },
  };
}

async function startOAuthAnimation(reducedMotion = false) {
  const animation = fakeAnimation();
  const frame = { dataset: { src: "/login/savia-logo.json" } };
  const panel = {
    querySelector: () => frame,
  };
  const script = await oauthPageResponse(request("oauth-ui.js"))!.text();
  let onVisibilityChange: (() => void) | undefined;
  const document = {
    body: { dataset: {} },
    hidden: false,
    querySelector: (selector: string) =>
      selector === "[data-oauth-login-animation]" ? panel : null,
    querySelectorAll: () => [],
    addEventListener(_name: string, listener: () => void) {
      onVisibilityChange = listener;
    },
  };
  const paths: string[] = [];
  new Function("document", "window", script)(document, {
    location: { search: "" },
    matchMedia: () => ({ matches: reducedMotion }),
    lottie: {
      loadAnimation(options: { path: string }) {
        paths.push(options.path);
        return animation;
      },
    },
  });
  return {
    animation,
    paths,
    hide() {
      document.hidden = true;
      onVisibilityChange?.();
    },
    show() {
      document.hidden = false;
      onVisibilityChange?.();
    },
  };
}

describe("tenant identity on OAuth surfaces", () => {
  it("renders the supplied Savia logo Lottie without the old video card", async () => {
    const html = await oauthPageResponse(request("login"))!.text();
    const css = await oauthPageResponse(request("oauth-ui.css"))!.text();

    expect(html).toContain('src="/login/lottie-light.min.js"');
    expect(html).toContain('data-src="/login/savia-logo.json"');
    expect(html).toContain('class="oauth-login-animation-wordmark"');
    expect(html).toContain("data-oauth-login-animation");
    expect(html).not.toContain('class="savia-mark"');
    expect(html).not.toContain("<video");
    expect(css).not.toContain("#071421");
  });

  it("plays the logo once and pauses while the tab is hidden", async () => {
    const { animation, paths, hide, show } = await startOAuthAnimation();
    expect(paths).toEqual(["/login/savia-logo.json"]);

    animation.emit("DOMLoaded");
    expect(animation.playCalls).toBe(1);
    hide();
    expect(animation.pauseCalls).toBe(1);
    show();
    expect(animation.playCalls).toBe(2);
    animation.emit("complete");
    hide();
    show();
    expect(animation.playCalls).toBe(2);
  });

  it("shows the completed logo without motion when requested", async () => {
    const { animation, hide, show } = await startOAuthAnimation(true);
    animation.emit("DOMLoaded");
    expect(animation.playCalls).toBe(0);
    expect(animation.stoppedFrames).toEqual([119]);
    hide();
    show();
    expect(animation.playCalls).toBe(0);
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
    expect(html).not.toContain("data-oauth-login-animation");
    expect(html).not.toContain("/login/lottie-light.min.js");
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
