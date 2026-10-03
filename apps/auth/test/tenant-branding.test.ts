import { env } from "cloudflare:workers";
import authWorker from "../src/index";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  loginAnimationUrl: null,
  loginAnimationRepeat: true,
  version: 1,
};
const animationUrl =
  "/api/public/tenant-branding/assets/1/12345678-1234-4234-8234-123456789014";
const request = (path: string) =>
  new Request(`https://example.com/api/auth/${path}`);

function fakeAnimation() {
  const listeners = new Map<string, () => void>();
  return {
    totalFrames: 120,
    playCalls: 0,
    pauseCalls: 0,
    stoppedFrames: [] as number[],
    playedFrames: [] as number[],
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
    goToAndPlay(frame: number) {
      this.playedFrames.push(frame);
    },
    emit(name: string) {
      listeners.get(name)?.();
    },
  };
}

async function startOAuthAnimation(reducedMotion = false, repeat = true) {
  const animation = fakeAnimation();
  const robotAnimation = fakeAnimation();
  const frame = { dataset: { src: "/login/savia-logo.json" } };
  const robot = { classList: { remove() {} } };
  const robotFrame = { dataset: { src: "/login/savia-chatbot-hover.json" } };
  const wordmark = { addEventListener() {} };
  const wordmarkAI = { addEventListener() {} };
  const elements: Record<string, object> = {
    "[data-oauth-login-animation-frame]": frame,
    "[data-oauth-login-robot]": robot,
    "[data-oauth-login-robot-frame]": robotFrame,
    "[data-oauth-login-wordmark]": wordmark,
    "[data-oauth-login-wordmark-ai]": wordmarkAI,
  };
  const panel = {
    dataset: { repeat: repeat ? "true" : "false" },
    querySelector: (selector: string) => elements[selector] ?? null,
  };
  const script = await oauthPageResponse(request("oauth-ui.js"))!.text();
  let onVisibilityChange: (() => void) | undefined;
  const document = {
    body: { dataset: {} },
    hidden: false,
    querySelector: (selector: string) =>
      selector === "[data-oauth-login-animation]" ? panel : null,
    querySelectorAll: () => [],
    addEventListener(name: string, listener: () => void) {
      if (name === "visibilitychange") onVisibilityChange = listener;
    },
  };
  let onPageHide: (() => void) | undefined;
  let onPageShow: (() => void) | undefined;
  const paths: string[] = [];
  new Function("document", "window", script)(document, {
    location: { search: "" },
    addEventListener(name: string, listener: () => void) {
      if (name === "pagehide") onPageHide = listener;
      if (name === "pageshow") onPageShow = listener;
    },
    matchMedia: () => ({ matches: reducedMotion }),
    lottie: {
      loadAnimation(options: { path: string }) {
        paths.push(options.path);
        return options.path === frame.dataset.src ? animation : robotAnimation;
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
    pagehide() {
      onPageHide?.();
    },
    pageshow() {
      onPageShow?.();
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("tenant identity on OAuth surfaces", () => {
  it.each(["login", "login?mode=forgot", "forgot-password"])(
    "omits recovery without email delivery on %s",
    async (path) => {
      const html = await oauthPageResponse(request(path), {
        emailAvailable: false,
      })!.text();
      expect(html).not.toContain('data-oauth-show="forgot"');
      expect(html).not.toContain('data-oauth-form="request-password-reset"');
      expect(html).not.toContain('data-oauth-form="sign-in" hidden');
    },
  );
  it.each(["login", "forgot-password"])(
    "offers recovery with email delivery on %s",
    async (path) => {
      const html = await oauthPageResponse(request(path), {
        emailAvailable: true,
      })!.text();
      expect(html).toContain('data-oauth-show="forgot"');
      expect(html).toContain('data-oauth-form="request-password-reset"');
    },
  );

  it.each([
    "localhost:8080",
    "savia.app.hefesoft.com",
    "savia-preview.hefesoft.com",
  ])("keeps platform login local on %s", async (host) => {
    const html = await oauthPageResponse(
      new Request(`http://${host}/api/auth/login`),
    )!.text();
    expect(html).toContain('data-oauth-form="sign-in"');
    expect(html).not.toContain('data-oauth-show="forgot"');
    expect(html).not.toContain("data-social-login");
    expect(html).not.toContain('data-oauth-show="sso"');
    expect(html).not.toContain('data-oauth-form="sso-discover"');
  });

  it.each(["acme.savia.app.hefesoft.com", "acme.savia-preview.hefesoft.com"])(
    "retains optional federated access on tenant host %s",
    async (host) => {
      const html = await oauthPageResponse(
        new Request(`https://${host}/api/auth/login`),
      )!.text();
      expect(html).toContain("data-social-login");
      expect(html).toContain('data-oauth-show="sso"');
      expect(html).toContain('data-oauth-form="sso-discover"');
    },
  );

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

  it("replays the completed logo every five seconds", async () => {
    vi.useFakeTimers();
    const { animation } = await startOAuthAnimation();
    animation.emit("DOMLoaded");
    animation.emit("complete");

    vi.advanceTimersByTime(4999);
    expect(animation.playedFrames).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(animation.playedFrames).toEqual([0]);

    animation.emit("complete");
    vi.advanceTimersByTime(5000);
    expect(animation.playedFrames).toEqual([0, 0]);
  });

  it("keeps the final frame when custom animation replay is disabled", async () => {
    vi.useFakeTimers();
    const { animation, hide, show, pagehide, pageshow } =
      await startOAuthAnimation(false, false);
    animation.emit("DOMLoaded");
    animation.emit("complete");

    vi.advanceTimersByTime(10000);
    hide();
    show();
    pagehide();
    pageshow();
    vi.advanceTimersByTime(10000);
    expect(animation.playedFrames).toEqual([]);
  });

  it("waits a fresh five seconds after a completed logo returns from a hidden tab", async () => {
    vi.useFakeTimers();
    const { animation, hide, show } = await startOAuthAnimation();
    animation.emit("DOMLoaded");
    animation.emit("complete");
    vi.advanceTimersByTime(2500);
    hide();
    vi.advanceTimersByTime(10000);
    expect(animation.playedFrames).toEqual([]);

    show();
    vi.advanceTimersByTime(4999);
    expect(animation.playedFrames).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(animation.playedFrames).toEqual([0]);
  });

  it("clears logo replay timers when the page is hidden by navigation", async () => {
    vi.useFakeTimers();
    const { animation, pagehide } = await startOAuthAnimation();
    animation.emit("DOMLoaded");
    animation.emit("complete");
    pagehide();
    vi.advanceTimersByTime(10000);
    expect(animation.playedFrames).toEqual([]);
  });

  it("resumes logo replay after a pagehide and pageshow cycle", async () => {
    vi.useFakeTimers();
    const { animation, pagehide, pageshow } = await startOAuthAnimation();
    animation.emit("DOMLoaded");
    animation.emit("complete");
    pagehide();
    vi.advanceTimersByTime(10000);
    expect(animation.playedFrames).toEqual([]);

    pageshow();
    vi.advanceTimersByTime(4999);
    expect(animation.playedFrames).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(animation.playedFrames).toEqual([0]);
  });

  it("plays the logo once and pauses while the tab is hidden", async () => {
    vi.useFakeTimers();
    const { animation, paths, hide, show } = await startOAuthAnimation();
    expect(paths).toEqual([
      "/login/savia-logo.json",
      "/login/savia-chatbot-hover.json",
    ]);

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
    vi.advanceTimersByTime(5000);
    expect(animation.playedFrames).toEqual([0]);
  });

  it("shows the completed logo without motion when requested", async () => {
    const { animation, hide, show } = await startOAuthAnimation(true);
    animation.emit("DOMLoaded");
    expect(animation.playCalls).toBe(0);
    expect(animation.stoppedFrames).toEqual([119]);
    hide();
    show();
    expect(animation.playCalls).toBe(0);
    vi.useFakeTimers();
    vi.advanceTimersByTime(30000);
    expect(animation.playedFrames).toEqual([]);
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
  it("preserves tenant identity while completing SSO and federated sign-in", async () => {
    const response = oauthPageResponse(request("sso-complete"), { branding })!;
    const html = await response.text();
    expect(html).toContain(
      `<title>Completando inicio de sesión | ${branding.displayName}</title>`,
    );
    expect(html).toContain('data-tenant-branding="true"');
    expect(html).toContain(branding.logoUrl!);
    expect(html).toContain("data-sso-complete");
    expect(html).toContain('id="oauth-status"');
    expect(html).toContain('href="/api/auth/login"');
  });
  it.each(["login", "mfa-enroll", "sso-complete"])(
    "keeps direct tenant %s on its own host when restarting authorization",
    async (path) => {
      const environment = {
        ...env,
        SAVIA_ADMIN_REDIRECT_URI:
          "https://savia-preview.hefesoft.com/auth/callback",
      };
      const response = await authWorker.fetch(
        new Request(
          `https://agency.savia-preview.hefesoft.com/api/auth/${path}`,
        ),
        environment,
      );
      expect(response.status).toBe(200);
      expect(
        (await response.text()).includes(
          'data-oauth-restart-url="https://agency.savia-preview.hefesoft.com/#/login"',
        ),
      ).toBe(true);
    },
  );
  it("does not restart authorization on an unrelated request host", async () => {
    const environment = {
      ...env,
      SAVIA_ADMIN_REDIRECT_URI:
        "https://savia-preview.hefesoft.com/auth/callback",
    };
    const response = await authWorker.fetch(
      new Request("https://unrelated.example/api/auth/login"),
      environment,
    );
    expect(
      (await response.text()).includes(
        'data-oauth-restart-url="https://savia-preview.hefesoft.com/#/login"',
      ),
    ).toBe(true);
  });
  it.each(["microsoft", "chatgpt"])(
    "keeps tenant branding on %s verification recovery pages",
    async (provider) => {
      const origin = "http://127.0.0.1:8787";
      for (const method of ["GET", "POST"]) {
        const id = "12345678-1234-4234-8234-123456789012";
        const url =
          method === "GET"
            ? `${origin}/api/auth/${provider}-email-verification?id=${id}`
            : `${origin}/api/auth/${provider}-email-verification/send`;
        const response = await authWorker.fetch(
          new Request(url, {
            method,
            headers: {
              origin,
              "content-type": "application/json",
              "x-savia-tenant-branding": encodeURIComponent(
                JSON.stringify(branding),
              ),
            },
            ...(method === "POST"
              ? {
                  body: JSON.stringify({
                    id,
                    email: "user@example.test",
                  }),
                }
              : {}),
          }),
          env,
        );
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('data-tenant-branding="true"');
        expect(html).toContain(branding.logoUrl!);
        expect(html).toContain(
          `<title>Verifica tu correo | ${branding.displayName}</title>`,
        );
      }
    },
  );
  it("renders a tenant login animation instead of the Savia emblem, robot and cover", async () => {
    const response = oauthPageResponse(request("login"), {
      branding: {
        ...branding,
        loginAnimationUrl: animationUrl,
        loginAnimationRepeat: false,
      },
    })!;
    const html = await response.text();
    expect(html).toContain(`data-src="${animationUrl}"`);
    expect(html).toContain('data-repeat="false"');
    expect(html).not.toContain('data-src="/login/savia-logo.json"');
    expect(html).not.toContain("data-oauth-login-robot");
    expect(html).not.toContain("oauth-login-animation-wordmark");
    expect(html).not.toContain("oauth-aside-cover");
    expect(html).toContain('src="/login/lottie-light.min.js"');
    expect(html).toContain('data-oauth-login-animation-custom="true"');
  });
  it("keeps the default Savia animation when no custom animation is set", async () => {
    const html = await oauthPageResponse(request("login"))!.text();
    expect(html).toContain('data-src="/login/savia-logo.json"');
    expect(html).toContain("data-oauth-login-robot");
    expect(html).toContain("oauth-login-animation-wordmark");
    expect(html).not.toContain("data-oauth-login-animation-custom");
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
