import {
  parseTenantBranding,
  type TenantBranding,
} from "@savia/tenant-host/branding";
import { parseTenantSlugFromHostname } from "@savia/tenant-host";
import { renderOAuthSurface } from "./login-ui";
import { oauthUiCssForBranding } from "./oauth-ui-css";

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function htmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function page(
  title: string,
  content: string,
  restartUrl?: string,
  showLoginAnimation = false,
): string {
  const restartAttribute = restartUrl
    ? ` data-oauth-restart-url="${htmlAttribute(restartUrl)}"`
    : "";
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlAttribute(title)}</title>
    <link rel="stylesheet" href="/api/auth/oauth-ui.css">
  </head>
  <body${restartAttribute}>
    <!-- THESIS: Login opens on Savia's product in motion while keeping access steps clear. OWN-WORLD: the light workspace meets a deep-navy media stage with teal accents. STORY: visitors see the product, enter credentials and continue through standard authentication. FIRST VIEWPORT: desktop places the form left and the 16:9 animation right; mobile puts the animation above the form. FORM: Shadcn login-02 split; MFA and consent retain their assurance panel. -->
    ${content}
    ${showLoginAnimation ? '<script src="/login/lottie-light.min.js" defer></script>' : ""}
    <script src="/api/auth/oauth-ui.js" defer></script>
  </body>
</html>`;
}

function htmlResponse(content: string): Response {
  return new Response(content, {
    headers: {
      ...securityHeaders,
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function loginPage(
  restartUrl?: string,
  tenantSlug?: string | null,
  branding?: TenantBranding,
): Response {
  const title = branding
    ? `${branding.loginTitle} | ${branding.displayName}`
    : tenantSlug
      ? `Iniciar sesión en ${tenantSlug} | Savia`
      : "Iniciar sesión | Savia";
  return htmlResponse(
    page(
      title,
      renderOAuthSurface("login", { tenantSlug, branding }),
      restartUrl,
      !branding?.coverUrl,
    ),
  );
}

function mfaEnrollmentPage(branding?: TenantBranding): Response {
  return htmlResponse(
    page(
      `Configura MFA | ${branding?.displayName ?? "Savia"}`,
      renderOAuthSurface("enroll", { branding }),
    ),
  );
}

function consentPage(branding?: TenantBranding): Response {
  return htmlResponse(
    page(
      `Autorizar ${branding?.displayName ?? "Savia"}`,
      renderOAuthSurface("consent", { branding }),
    ),
  );
}

function scriptResponse(): Response {
  return new Response(oauthUiScript, {
    headers: {
      ...securityHeaders,
      "content-type": "application/javascript; charset=utf-8",
    },
  });
}

function styleResponse(branding?: TenantBranding): Response {
  return new Response(oauthUiCssForBranding(branding), {
    headers: {
      ...securityHeaders,
      "content-type": "text/css; charset=utf-8",
    },
  });
}

export function oauthPageResponse(
  request: Request,
  options?: { restartUrl?: string; branding?: TenantBranding },
): Response | undefined {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  const tenantSlug = parseTenantSlugFromHostname(url.hostname);
  const branding = parseTenantBranding(options?.branding) ?? undefined;
  switch (url.pathname) {
    case "/api/auth/login":
      return loginPage(options?.restartUrl, tenantSlug, branding);
    case "/api/auth/mfa-enroll":
      return mfaEnrollmentPage(branding);
    case "/api/auth/consent":
      return consentPage(branding);
    case "/api/auth/oauth-ui.js":
      return scriptResponse();
    case "/api/auth/oauth-ui.css":
      return styleResponse(branding);
    default:
      return undefined;
  }
}

const oauthUiScript = String.raw`(() => {
  "use strict";

  const status = document.querySelector("#oauth-status");
  const loginForm = document.querySelector('[data-oauth-form="sign-in"]');
  const twoFactor = document.querySelector("[data-oauth-two-factor]");
  const enrollment = document.querySelector("[data-oauth-enrollment]");
  const passwordInput = document.querySelector("#password");
  const passwordToggle = document.querySelector("[data-oauth-password-toggle]");
  const loginAnimation = document.querySelector("[data-oauth-login-animation]");

  if (loginAnimation && window.lottie) {
    const frames = Array.from(
      loginAnimation.querySelectorAll("[data-oauth-login-animation-frame]"),
    );
    const toggle = loginAnimation.querySelector(
      "[data-oauth-login-animation-toggle]",
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animations = frames.map((frame) => window.lottie.loadAnimation({
      container: frame,
      renderer: "svg",
      loop: false,
      autoplay: false,
      path: frame.dataset.src,
    }));
    const ready = animations.map(() => false);
    let activeIndex = 0;
    let paused = reducedMotion;

    function updateToggle() {
      toggle?.setAttribute("aria-pressed", String(paused));
      toggle?.setAttribute(
        "aria-label",
        paused ? "Reanudar animación" : "Pausar animación",
      );
    }

    function playActive() {
      if (!paused && !document.hidden && ready[activeIndex]) {
        animations[activeIndex].play();
      }
    }

    animations.forEach((animation, index) => {
      animation.addEventListener("DOMLoaded", () => {
        ready[index] = true;
        animation.goToAndStop(0, true);
        if (index === activeIndex) {
          loginAnimation.dataset.active = String(index);
          loginAnimation.dataset.ready = "true";
          playActive();
        }
      });
      animation.addEventListener("complete", () => {
        if (index !== activeIndex || paused) return;
        activeIndex = (index + 1) % animations.length;
        if (!ready[activeIndex]) return;
        loginAnimation.dataset.active = String(activeIndex);
        loginAnimation.dataset.ready = "true";
        animations[activeIndex].goToAndStop(0, true);
        playActive();
      });
    });

    toggle?.addEventListener("click", () => {
      paused = !paused;
      updateToggle();
      if (paused) animations.forEach((animation) => animation.pause());
      else playActive();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) animations.forEach((animation) => animation.pause());
      else playActive();
    });
    updateToggle();
  }

  function signedOAuthQuery() {
    const source = new URLSearchParams(window.location.search);
    if (!source.has("sig")) return undefined;
    const signedNames = new Set(source.getAll("ba_param"));
    if (!signedNames.size) return undefined;
    const result = new URLSearchParams();
    for (const [key, value] of source.entries()) {
      if (key === "sig" || key === "ba_param" || signedNames.has(key)) {
        result.append(key, value);
      }
    }
    return result.toString();
  }

  const oauthQuery = signedOAuthQuery();

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function readableError(payload, fallback) {
    if (payload && typeof payload === "object") {
      const value = payload.error_description || payload.message || payload.error;
      if (typeof value === "string") return value;
    }
    return fallback;
  }

  function requestError(payload, fallback) {
    const error = new Error(readableError(payload, fallback));
    if (payload && typeof payload === "object" && typeof payload.error === "string") {
      error.code = payload.error;
    }
    return error;
  }

  async function request(path, payload) {
    const body = { ...payload };
    if (oauthQuery) body.oauth_query = oauthQuery;
    const response = await fetch("/api/auth/" + path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let result = {};
    if (text) {
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error("El servidor devolvió una respuesta no válida.");
      }
    }
    if (!response.ok) throw requestError(result, "No fue posible completar la solicitud.");
    return result;
  }

  function restartExpiredAuthorization(error) {
    if (!(error instanceof Error) || error.code !== "invalid_signature") return false;
    const restartUrl = document.body && document.body.dataset && document.body.dataset.oauthRestartUrl;
    if (typeof restartUrl !== "string" || !restartUrl) return false;
    window.location.replace(restartUrl);
    return true;
  }

  function redirectFromServer(result) {
    if (!result || typeof result !== "object") return false;
    const candidates = [
      result.redirect_uri,
      result.url,
      result.data && result.data.redirect_uri,
      result.data && result.data.url,
    ];
    const redirect = candidates.find((value) => typeof value === "string");
    if (typeof redirect !== "string") return false;
    window.location.assign(redirect);
    return true;
  }

  async function continueAfterEnrollment() {
    const result = await request("oauth2/continue", { postLogin: true });
    if (!redirectFromServer(result)) {
      throw new Error("La autorización no devolvió un destino de continuación.");
    }
  }

  function formValue(form, name) {
    const value = new FormData(form).get(name);
    return typeof value === "string" ? value : "";
  }

  function setSubmitting(form, submitting) {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = submitting;
  }

  function bindPasswordVisibility() {
    if (!passwordInput || !passwordToggle) return;
    passwordToggle.addEventListener("click", () => {
      const visible = passwordInput.type === "password";
      passwordInput.type = visible ? "text" : "password";
      passwordToggle.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
      passwordToggle.setAttribute("aria-pressed", String(visible));
    });
  }

  function renderConsentDetails() {
    const params = new URLSearchParams(oauthQuery || "");
    const client = params.get("client_id");
    const clientTarget = document.querySelector("[data-oauth-client]");
    if (client && clientTarget) clientTarget.textContent = "La aplicación " + client + " solicita acceso a tu cuenta.";
    const scopeList = document.querySelector("[data-oauth-scopes]");
    if (!scopeList) return;
    for (const scope of (params.get("scope") || "").split(" ").filter(Boolean)) {
      const item = document.createElement("li");
      item.textContent = scope;
      scopeList.append(item);
    }
  }

  async function submitSignIn(form) {
    const result = await request("sign-in/email", {
      email: formValue(form, "email"),
      password: formValue(form, "password"),
    });
    if (result.twoFactorRedirect === true) {
      form.hidden = true;
      if (twoFactor) twoFactor.hidden = false;
      setStatus("Ingresa tu segundo factor para continuar.");
      return;
    }
    if (!redirectFromServer(result)) await continueAfterEnrollment();
  }

  async function submitSecondFactor(form, path) {
    const result = await request(path, { code: formValue(form, "code") });
    if (!redirectFromServer(result)) await continueAfterEnrollment();
  }

  async function submitEnrollment(form) {
    const result = await request("two-factor/enable", {
      password: formValue(form, "password"),
      method: "totp",
    });
    const uri = document.querySelector("[data-oauth-totp-uri]");
    if (uri) uri.textContent = typeof result.totpURI === "string" ? result.totpURI : "";
    const qr = document.querySelector("[data-oauth-totp-qr]");
    if (qr) {
      const qrDataUrl = typeof result.totpQrDataUrl === "string" ? result.totpQrDataUrl : "";
      if (qrDataUrl.startsWith("data:image/svg+xml;base64,")) {
        qr.src = qrDataUrl;
        qr.hidden = false;
      } else {
        qr.removeAttribute("src");
        qr.hidden = true;
      }
    }
    const codes = document.querySelector("[data-oauth-backup-codes]");
    if (codes) {
      codes.replaceChildren();
      for (const code of Array.isArray(result.backupCodes) ? result.backupCodes : []) {
        const item = document.createElement("li");
        item.textContent = String(code);
        codes.append(item);
      }
    }
    form.hidden = true;
    if (enrollment) enrollment.hidden = false;
    setStatus("Escanea el código QR y confirma el código de tu aplicación autenticadora.");
  }

  async function submitEnrollmentVerification(form) {
    await request("two-factor/verify-totp", { code: formValue(form, "code") });
    await continueAfterEnrollment();
  }

  function bindForms() {
    for (const form of document.querySelectorAll("[data-oauth-form]")) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setSubmitting(form, true);
        try {
          switch (form.dataset.oauthForm) {
            case "sign-in":
              await submitSignIn(form);
              break;
            case "verify-totp":
              await submitSecondFactor(form, "two-factor/verify-totp");
              break;
            case "verify-backup-code":
              await submitSecondFactor(form, "two-factor/verify-backup-code");
              break;
            case "enable-totp":
              await submitEnrollment(form);
              break;
            case "verify-enrollment":
              await submitEnrollmentVerification(form);
              break;
            case "consent": {
              const result = await request("oauth2/consent", { accept: true });
              if (!redirectFromServer(result)) throw new Error("La autorización no devolvió un destino de continuación.");
              break;
            }
          }
        } catch (error) {
          if (!restartExpiredAuthorization(error)) {
            setStatus(error instanceof Error ? error.message : "No fue posible completar la solicitud.");
          }
        } finally {
          setSubmitting(form, false);
        }
      });
    }
  }

  renderConsentDetails();
  bindPasswordVisibility();
  bindForms();
})();`;

export function tenantBrandingFromHeader(
  value: string | null,
): TenantBranding | undefined {
  if (!value || value.length > 12000) return undefined;
  try {
    return parseTenantBranding(decodeURIComponent(value)) ?? undefined;
  } catch {
    return undefined;
  }
}
