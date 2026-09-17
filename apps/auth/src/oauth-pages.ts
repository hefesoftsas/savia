import { parseTenantSlugFromHostname } from "@savia/tenant-host";
import { renderOAuthSurface } from "./login-ui";
import { oauthUiCss } from "./oauth-ui-css";

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

function page(title: string, content: string, restartUrl?: string): string {
  const restartAttribute = restartUrl
    ? ` data-oauth-restart-url="${htmlAttribute(restartUrl)}"`
    : "";
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <link rel="stylesheet" href="/api/auth/oauth-ui.css">
  </head>
  <body${restartAttribute}>
    <!-- THESIS: A secure OAuth step should feel like one focused workspace, not a generic identity portal. OWN-WORLD: calm Savia teal on a light operational canvas, with a deep-navy trust panel. STORY: identify the requested access, authenticate, then return to the client without losing context. FIRST VIEWPORT: login form at left, Savia assurance panel at right, action immediately below the credentials. FORM: Shadcn login-02 two-column composition, adapted for email, password and MFA. -->
    ${content}
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

function loginPage(restartUrl?: string, tenantSlug?: string | null): Response {
  const title = tenantSlug
    ? `Iniciar sesión en ${tenantSlug} | Savia`
    : "Iniciar sesión | Savia";
  return htmlResponse(
    page(title, renderOAuthSurface("login", { tenantSlug }), restartUrl),
  );
}

function mfaEnrollmentPage(): Response {
  return htmlResponse(
    page("Configura MFA | Savia", renderOAuthSurface("enroll")),
  );
}

function consentPage(): Response {
  return htmlResponse(page("Autorizar Savia", renderOAuthSurface("consent")));
}

function scriptResponse(): Response {
  return new Response(oauthUiScript, {
    headers: {
      ...securityHeaders,
      "content-type": "application/javascript; charset=utf-8",
    },
  });
}

function styleResponse(): Response {
  return new Response(oauthUiCss, {
    headers: {
      ...securityHeaders,
      "content-type": "text/css; charset=utf-8",
    },
  });
}

export function oauthPageResponse(
  request: Request,
  options?: { restartUrl?: string },
): Response | undefined {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  const tenantSlug = parseTenantSlugFromHostname(url.hostname);
  switch (url.pathname) {
    case "/api/auth/login":
      return loginPage(options?.restartUrl, tenantSlug);
    case "/api/auth/mfa-enroll":
      return mfaEnrollmentPage();
    case "/api/auth/consent":
      return consentPage();
    case "/api/auth/oauth-ui.js":
      return scriptResponse();
    case "/api/auth/oauth-ui.css":
      return styleResponse();
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
