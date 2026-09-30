import { saviaLoadingHtml } from "@savia/tenant-host/loading";
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
    <!-- THESIS: Login opens on Savia's identity in motion while keeping access steps clear. OWN-WORLD: the light workspace meets a deep-navy stage with teal accents. STORY: visitors see the animated logo, enter credentials and continue through standard authentication. FIRST VIEWPORT: desktop places the form left and the logo right; mobile puts the logo above the form. FORM: Shadcn login-02 split; MFA and consent retain their assurance panel. -->
    <div data-oauth-content>${content}</div>
    ${saviaLoadingHtml}
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
  accountState?: { panel: "forgot" | "verify"; notice?: string },
  emailAvailable = false,
  allowEmailRegistration = false,
): Response {
  const title = branding
    ? `${branding.loginTitle} | ${branding.displayName}`
    : tenantSlug
      ? `Iniciar sesión en ${tenantSlug} | Savia`
      : "Iniciar sesión | Savia";
  return htmlResponse(
    page(
      title,
      renderOAuthSurface("login", {
        tenantSlug,
        branding,
        emailAvailable,
        allowEmailRegistration,
        initialPanel:
          accountState?.panel === "forgot" && !emailAvailable
            ? undefined
            : accountState?.panel,
        initialNotice: accountState?.notice,
      }),
      restartUrl,
      !!branding?.loginAnimationUrl || !branding?.coverUrl,
    ),
  );
}

function mfaEnrollmentPage(
  branding?: TenantBranding,
  restartUrl?: string,
): Response {
  return htmlResponse(
    page(
      `Configura MFA | ${branding?.displayName ?? "Savia"}`,
      renderOAuthSurface("enroll", { branding }),
      restartUrl,
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

function verifiedPage(
  branding?: TenantBranding,
  verificationError?: string | null,
): Response {
  if (verificationError) {
    return htmlResponse(
      page(
        `Verifica tu correo | ${branding?.displayName ?? "Savia"}`,
        renderOAuthSurface("login", {
          branding,
          initialPanel: "verify",
          initialNotice:
            "El enlace expiró o no es válido. Solicita un nuevo enlace de verificación.",
        }),
      ),
    );
  }
  return htmlResponse(
    page(
      `Correo verificado | ${branding?.displayName ?? "Savia"}`,
      renderOAuthSurface("verified", { branding }),
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
  options?: {
    restartUrl?: string;
    branding?: TenantBranding;
    emailAvailable?: boolean;
    allowEmailRegistration?: boolean;
  },
): Response | undefined {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  const tenantSlug = parseTenantSlugFromHostname(url.hostname);
  const branding = parseTenantBranding(options?.branding) ?? undefined;
  switch (url.pathname) {
    case "/api/auth/sso-complete":
      return htmlResponse(
        page(
          "Completando inicio de sesión | Savia",
          '<main class="oauth-shell"><section data-sso-complete><h1>Completando inicio de sesión</h1><p id="oauth-status" role="status">Validando tu acceso…</p><a href="/api/auth/login">Volver al inicio de sesión</a></section></main>',
          options?.restartUrl,
        ),
      );
    case "/api/auth/login":
      return url.searchParams.get("mode") === "forgot"
        ? loginPage(
            options?.restartUrl,
            tenantSlug,
            branding,
            {
              panel: "forgot",
            },
            options?.emailAvailable,
            options?.allowEmailRegistration,
          )
        : loginPage(
            options?.restartUrl,
            tenantSlug,
            branding,
            undefined,
            options?.emailAvailable,
            options?.allowEmailRegistration,
          );
    case "/api/auth/forgot-password":
      return loginPage(
        options?.restartUrl,
        tenantSlug,
        branding,
        {
          panel: "forgot",
        },
        options?.emailAvailable,
        options?.allowEmailRegistration,
      );
    case "/api/auth/mfa-enroll":
      return mfaEnrollmentPage(branding, options?.restartUrl);
    case "/api/auth/consent":
      return consentPage(branding);
    case "/api/auth/email-verified":
      return verifiedPage(
        branding,
        url.searchParams.get("error") ??
          url.searchParams.get("error_description"),
      );
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
  const loginPanel = document.querySelector('[data-oauth-form="sign-in"]');
  const recoveryPanel = document.querySelector('[data-oauth-panel="forgot"]');
  const verificationPanel = document.querySelector('[data-oauth-panel="verify"]');
  const passwordToggle = document.querySelector("[data-oauth-password-toggle]");
  const loginAnimation = document.querySelector("[data-oauth-login-animation]");

  if (loginAnimation && window.lottie) {
    const frame = loginAnimation.querySelector("[data-oauth-login-animation-frame]");
    const robot = loginAnimation.querySelector("[data-oauth-login-robot]");
    const robotFrame = loginAnimation.querySelector("[data-oauth-login-robot-frame]");
    const wordmark = loginAnimation.querySelector("[data-oauth-login-wordmark]");
    const wordmarkAI = loginAnimation.querySelector("[data-oauth-login-wordmark-ai]");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = window.lottie.loadAnimation({
      container: frame,
      renderer: "svg",
      loop: false,
      autoplay: false,
      path: frame.dataset.src,
    });
    const robotAnimation = reducedMotion || !robot || !robotFrame ? null : window.lottie.loadAnimation({
      container: robotFrame,
      renderer: "svg",
      loop: false,
      autoplay: false,
      path: robotFrame.dataset.src,
    });
    let ready = false;
    let finished = false;
    let robotReady = false;
    let robotGreetingPending = false;
    let robotTriggerTimer;
    let robotHideTimer;

    function replayClass(element, name) {
      if (reducedMotion) return;
      element.classList.remove(name);
      void element.offsetWidth;
      element.classList.add(name);
    }

    function greetWithRobot() {
      if (!robotAnimation || !robot || document.hidden) return;
      if (!robotReady) {
        robotGreetingPending = true;
        return;
      }
      robotGreetingPending = false;
      clearTimeout(robotHideTimer);
      robot.classList.remove("robot-visible");
      void robot.offsetWidth;
      robot.classList.add("robot-visible");
      robotAnimation.goToAndStop(35, true);
      robotAnimation.playSegments([35, 174], true);
    }

    function queueRobotGreeting(event) {
      if (reducedMotion || !robotAnimation || event.pointerType === "touch" || document.hidden) return;
      clearTimeout(robotTriggerTimer);
      robotTriggerTimer = setTimeout(greetWithRobot, 3000);
    }

    function cancelRobotGreeting() {
      clearTimeout(robotTriggerTimer);
      robotGreetingPending = false;
    }

    animation.addEventListener("DOMLoaded", () => {
      ready = true;
      if (reducedMotion) {
        animation.goToAndStop(animation.totalFrames - 1, true);
        finished = true;
      } else if (!document.hidden) animation.play();
    });
    animation.addEventListener("complete", () => { finished = true; });
    robotAnimation?.addEventListener("DOMLoaded", () => {
      robotReady = true;
      if (robotGreetingPending) greetWithRobot();
    });
    robotAnimation?.addEventListener("complete", () => {
      robotHideTimer = setTimeout(() => robot.classList.remove("robot-visible"), 1400);
    });
    frame.addEventListener?.("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      replayClass(frame, "logo-hover");
      queueRobotGreeting(event);
    });
    frame.addEventListener?.("pointerleave", cancelRobotGreeting);
    wordmark?.addEventListener("pointerenter", queueRobotGreeting);
    wordmark?.addEventListener("pointerleave", cancelRobotGreeting);
    wordmarkAI?.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") replayClass(wordmarkAI, "ai-hover");
    });
    frame.addEventListener?.("animationend", (event) => {
      if (event.animationName === "oauth-logo-hover-pulse") frame.classList.remove("logo-hover");
    });
    wordmarkAI?.addEventListener("animationend", (event) => {
      if (event.animationName === "oauth-ai-hover-pop") wordmarkAI.classList.remove("ai-hover");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelRobotGreeting();
        clearTimeout(robotHideTimer);
        robotAnimation?.pause();
        robot?.classList.remove("robot-visible");
      }
      if (!ready || finished) return;
      if (document.hidden) animation.pause();
      else animation.play();
    });
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
    redirecting = true;
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
    redirecting = true;
    window.location.assign(redirect);
    return true;
  }

  async function continueAfterEnrollment() {
    if (!oauthQuery) {
      const restartUrl = document.body && document.body.dataset && document.body.dataset.oauthRestartUrl;
      if (typeof restartUrl !== "string" || !restartUrl) {
        throw new Error("Abre Savia para iniciar una nueva solicitud de acceso.");
      }
      redirecting = true;
      window.location.replace(restartUrl);
      return;
    }
    const result = await request("oauth2/continue", { postLogin: true });
    if (!redirectFromServer(result)) {
      throw new Error("La autorización no devolvió un destino de continuación.");
    }
  }

  function formValue(form, name) {
    const value = new FormData(form).get(name);
    return typeof value === "string" ? value : "";
  }

  let redirecting = false;
  function setSubmitting(form, submitting) {
    const loading = document.querySelector("[data-oauth-loading]");
    const content = document.querySelector("[data-oauth-content]");
    const showLoading = submitting || redirecting;
    if (loading) loading.hidden = !showLoading;
    if (content) content.hidden = showLoading;
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

  function showAccountPanel(name) {
    if (loginPanel) loginPanel.hidden = name !== "login";
    const social = document.querySelector("[data-social-login]");
    if (social) social.hidden = name !== "login" || social.dataset.available !== "true";
    if (recoveryPanel) recoveryPanel.hidden = name !== "forgot";
    if (verificationPanel) verificationPanel.hidden = name !== "verify";
    const ssoPanel = document.querySelector('[data-oauth-panel="sso"]');
    if (ssoPanel) ssoPanel.hidden = name !== "sso";
    const actions = document.querySelector("[data-oauth-account-actions]");
    if (actions) actions.hidden = name !== "login";
    if (name === "sso") {
      const email = document.querySelector("#email");
      const ssoEmail = document.querySelector("#sso-email");
      if (ssoEmail && email && !ssoEmail.value) ssoEmail.value = email.value;
    }
    const activePanel = document.querySelector('[data-oauth-panel="' + name + '"]');
    if (activePanel) {
      for (const form of activePanel.querySelectorAll("form")) form.hidden = false;
      activePanel.querySelector("input")?.focus();
    }
    setStatus("");
  }

  async function startSSO(providerId) {
    const callback = new URL("/api/auth/sso-complete", window.location.origin);
    // Carry the existing OAuth continuation through the signed SAML RelayState.
    callback.search = window.location.search;
    const result = await request("sign-in/sso", {providerId, callbackURL: callback.href});
    if (!redirectFromServer(result)) throw new Error("No fue posible iniciar SSO.");
  }

  const socialLogin = document.querySelector("[data-social-login]");
  if (socialLogin) {
    fetch("/api/auth/savia-social/providers", {credentials:"same-origin"})
      .then(response => response.ok ? response.json() : {providers:[]})
      .then(({providers}) => {
        if (!Array.isArray(providers)) return;
        for (const button of socialLogin.querySelectorAll("[data-social-provider]")) {
          button.hidden = !providers.includes(button.dataset.socialProvider);
          button.addEventListener("click", async () => {
            const buttons = [...socialLogin.querySelectorAll("button")];
            buttons.forEach(item => item.disabled = true);
            setStatus("Conectando con tu proveedor de identidad…");
            try {
              const callback = new URL("/api/auth/sso-complete", window.location.origin);
              callback.search = window.location.search;
              const result = await request("sign-in/social", {provider:button.dataset.socialProvider, callbackURL:callback.href, errorCallbackURL:callback.href});
              if (!redirectFromServer(result)) throw new Error("No fue posible iniciar sesión con este proveedor.");
            } catch (error) {
              setStatus(error instanceof Error ? error.message : "No fue posible iniciar sesión.");
              buttons.forEach(item => item.disabled = false);
            }
          });
        }
        socialLogin.dataset.available = providers.length ? "true" : "false";
        socialLogin.hidden = !providers.length || !loginPanel || loginPanel.hidden;
      }).catch(() => { socialLogin.hidden = true; });
  }

  async function submitSSODiscovery(form) {
    const email = formValue(form, "email").trim();
    const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    const response = await fetch("/api/auth/savia-sso/connections?domain=" + encodeURIComponent(domain), {credentials:"same-origin"});
    if (!response.ok) throw new Error("No fue posible consultar las conexiones de SSO.");
    const result = await response.json();
    const choices = document.querySelector("[data-sso-connections]");
    if (choices) choices.replaceChildren();
    if (!result.connections?.length) throw new Error("No encontramos una conexión SSO para este correo. Consulta con tu administrador.");
    if (result.connections.length === 1) return startSSO(result.connections[0].providerId);
    for (const connection of result.connections) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = connection.displayName;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await startSSO(connection.providerId); }
        catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible iniciar SSO."); button.disabled = false; }
      });
      choices?.append(button);
    }
    setStatus("Selecciona tu organización para continuar.");
  }

  async function submitRecovery(form) {
    await request("request-password-reset", { email: formValue(form, "email") });
    form.hidden = true;
    setStatus("Si encontramos una cuenta con ese correo, recibirás un enlace para recuperar la contraseña.");
  }

  async function submitVerification(form) {
    await request("send-verification-email", { email: formValue(form, "email") });
    form.hidden = true;
    setStatus("Si la cuenta necesita verificación, recibirás un enlace en ese correo.");
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
    for (const control of document.querySelectorAll("[data-oauth-show]")) {
      control.addEventListener("click", () => showAccountPanel(control.dataset.oauthShow));
    }
    for (const form of document.querySelectorAll("[data-oauth-form]")) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setSubmitting(form, true);
        try {
          switch (form.dataset.oauthForm) {
            case "sso-discover":
              await submitSSODiscovery(form);
              break;
            case "sign-in":
              await submitSignIn(form);
              break;
            case "request-password-reset":
              await submitRecovery(form);
              break;
            case "send-verification-email":
              await submitVerification(form);
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
            if (error && error.code === "EMAIL_NOT_VERIFIED" && form.dataset.oauthForm === "sign-in") {
              const verificationEmail = document.querySelector("#verification-email");
              if (verificationEmail) verificationEmail.value = formValue(form, "email");
              showAccountPanel("verify");
              setStatus("Verifica tu correo antes de iniciar sesión. Puedes solicitar un nuevo enlace aquí.");
            } else {
              setStatus(error instanceof Error ? error.message : "No fue posible completar la solicitud.");
            }
          }
        } finally {
          setSubmitting(form, false);
        }
      });
    }
  }

  if (document.querySelector("[data-sso-complete]")) {
    if (new URLSearchParams(window.location.search).has("error")) {
      setStatus("No fue posible validar tu acceso con el proveedor. Usa tu cuenta verificada y el método autorizado por tu organización, o consulta con tu administrador.");
    } else continueAfterEnrollment().catch(error => { if (!restartExpiredAuthorization(error)) setStatus(error instanceof Error ? error.message : "No fue posible completar SSO."); });
  }

  if (new URLSearchParams(window.location.search).get("mode") === "sso-mfa" && twoFactor) {
    if (loginPanel) loginPanel.hidden = true;
    twoFactor.hidden = false;
    setStatus("Ingresa tu segundo factor para completar el acceso.");
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

export function microsoftVerificationPage(
  verification: { id: string; email: string; notice?: string },
  branding?: TenantBranding,
): Response {
  return htmlResponse(
    page(
      "Verifica tu correo | Savia",
      renderOAuthSurface("microsoft-verification", { verification, branding }),
    ),
  );
}
