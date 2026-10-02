import * as React from "react";
import type { TenantBranding } from "@savia/tenant-host/branding";
import { renderToStaticMarkup } from "react-dom/server";
import { saviaLargeLogoDataUri, saviaLogoDataUri } from "./savia-logo";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

type Screen =
  | "login"
  | "sso-complete"
  | "enroll"
  | "consent"
  | "verified"
  | "microsoft-verification"
  | "chatgpt-verification";

function SaviaMark({ branding }: { branding?: TenantBranding }) {
  return (
    <img
      className="savia-mark"
      src={branding?.logoUrl ?? saviaLogoDataUri}
      alt={branding?.displayName ?? "Savia"}
      width={40}
      height={40}
    />
  );
}

function Shell({
  screen,
  children,
  branding,
}: {
  screen: Screen;
  branding?: TenantBranding;
  children: React.ReactNode;
}) {
  const context =
    screen === "consent"
      ? "Autorización de aplicación"
      : screen === "enroll"
        ? "Protección de cuenta"
        : screen === "verified"
          ? "Cuenta verificada"
          : "Acceso seguro";
  // A tenant's custom login animation takes precedence over its cover image.
  const customLoginAnimation = branding?.loginAnimationUrl ?? null;
  const showLoginAnimation =
    screen === "login" && (!branding?.coverUrl || customLoginAnimation);
  return (
    <div
      className="oauth-screen"
      data-tenant-branding={branding ? "true" : undefined}
    >
      <section className="oauth-workspace" aria-label={context}>
        <a
          className="savia-brand"
          href="/docs"
          aria-label={branding?.displayName ?? "Savia API"}
        >
          <img
            className="savia-brand-logo"
            src={branding?.logoUrl ?? saviaLargeLogoDataUri}
            alt={branding?.displayName ?? "Savia"}
            height={36}
          />
        </a>
        <div className="oauth-form-column">{children}</div>
      </section>
      <aside
        className={`oauth-aside${branding?.coverUrl && !customLoginAnimation ? " has-cover" : ""}${showLoginAnimation ? " has-login-animation" : ""}`}
        aria-label={
          showLoginAnimation
            ? customLoginAnimation
              ? `Animación de ${branding?.displayName ?? "inicio de sesión"}`
              : "Animación de Savia"
            : undefined
        }
        aria-hidden={showLoginAnimation ? undefined : "true"}
      >
        {branding?.coverUrl && !customLoginAnimation && (
          <img className="oauth-aside-cover" src={branding.coverUrl} alt="" />
        )}
        {showLoginAnimation ? (
          <div
            className="oauth-login-animation"
            data-oauth-login-animation
            data-repeat={
              branding?.loginAnimationRepeat === false ? "false" : "true"
            }
            data-oauth-login-animation-custom={
              customLoginAnimation ? "true" : undefined
            }
          >
            <div
              className="oauth-login-animation-frame"
              data-oauth-login-animation-frame
              data-src={customLoginAnimation ?? "/login/savia-logo.json"}
            />
            {customLoginAnimation ? null : (
              <div
                className="oauth-login-animation-robot"
                data-oauth-login-robot
                aria-hidden="true"
              >
                <div
                  className="oauth-login-animation-robot-frame"
                  data-oauth-login-robot-frame
                  data-src="/login/savia-chatbot-hover.json"
                />
              </div>
            )}
            {customLoginAnimation ? null : (
              <p
                className="oauth-login-animation-wordmark"
                data-oauth-login-wordmark
                aria-label="Savia"
              >
                <span>sav</span>
                <span data-oauth-login-wordmark-ai>ia</span>
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="oauth-aside-mark">
              <SaviaMark branding={branding} />
            </div>
            <div className="oauth-aside-illustration">
              <svg
                className="oauth-insurance-ai"
                viewBox="0 0 320 260"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  className="oauth-insurance-ai-connection"
                  d="M42 72L107 106M213 70L161 104M75 204L127 163M246 201L190 163"
                />
                <path
                  className="oauth-insurance-ai-orbit"
                  d="M85 52C106 30 137 18 169 20C215 22 254 54 266 97"
                />
                <path
                  className="oauth-insurance-ai-shield"
                  d="M160 53L214 76V123C214 163 190 194 160 210C130 194 106 163 106 123V76L160 53Z"
                />
                <path
                  className="oauth-insurance-ai-core"
                  d="M135 111C135 97 146 87 160 87C174 87 185 97 185 111V143C185 157 174 168 160 168C146 168 135 157 135 143V111Z"
                />
                <path
                  className="oauth-insurance-ai-circuit"
                  d="M135 118H120V101M185 118H200V101M135 143H120V160M185 143H200V160M160 87V72M160 168V184"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="42"
                  cy="72"
                  r="7"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="213"
                  cy="70"
                  r="7"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="75"
                  cy="204"
                  r="7"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="246"
                  cy="201"
                  r="7"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="120"
                  cy="101"
                  r="5"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="200"
                  cy="101"
                  r="5"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="120"
                  cy="160"
                  r="5"
                />
                <circle
                  className="oauth-insurance-ai-node"
                  cx="200"
                  cy="160"
                  r="5"
                />
              </svg>
            </div>
            <div>
              <p className="oauth-aside-eyebrow">
                {branding?.displayName ?? "Savia · IA para seguros"}
              </p>
              <p className="oauth-aside-title">
                {branding?.loginTitle ??
                  "Seguros que anticipan. IA que acelera."}
              </p>
              <p className="oauth-aside-copy">
                {branding?.loginDescription ??
                  "Conecta información, cobertura y decisiones para una operación más clara y ágil."}
              </p>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Status({ initialNotice }: { initialNotice?: string } = {}) {
  return (
    <p id="oauth-status" role="status" aria-live="polite">
      {initialNotice}
    </p>
  );
}

function LoginContent({
  tenantSlug,
  branding,
  initialPanel,
  initialNotice,
  emailAvailable = false,
  allowEmailRegistration = false,
}: {
  tenantSlug?: string | null;
  branding?: TenantBranding;
  initialPanel?: "forgot" | "verify";
  initialNotice?: string;
  emailAvailable?: boolean;
  allowEmailRegistration?: boolean;
} = {}) {
  const workspaceKicker = tenantSlug
    ? `Espacio de trabajo · ${tenantSlug}`
    : "Acceso a Savia";
  const workspaceSubtitle = tenantSlug
    ? `Autentícate para ingresar a ${tenantSlug}.`
    : "Autentícate para continuar con la autorización solicitada.";

  return (
    <Shell screen="login" branding={branding}>
      <div className="oauth-heading">
        <p className="oauth-kicker">
          {branding?.displayName ?? workspaceKicker}
        </p>
        <h1>{branding?.loginTitle ?? "Inicia sesión"}</h1>
        <p>{branding?.loginDescription ?? workspaceSubtitle}</p>
      </div>
      <form
        className="oauth-form"
        action="sign-in"
        method="post"
        data-oauth-form="sign-in"
        hidden={!!initialPanel}
      >
        <div className="oauth-field">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="nombre@empresa.com"
            required
          />
        </div>
        <div className="oauth-field">
          <Label htmlFor="password">Contraseña</Label>
          <div className="oauth-password-control">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={12}
              required
            />
            <button
              className="oauth-password-toggle"
              type="button"
              data-oauth-password-toggle
              aria-controls="password"
              aria-label="Mostrar contraseña"
              aria-pressed="false"
            >
              <svg
                className="oauth-password-toggle-icon"
                data-oauth-password-toggle-icon="show"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                <circle cx="12" cy="12" r="2.75" />
              </svg>
              <svg
                className="oauth-password-toggle-icon"
                data-oauth-password-toggle-icon="hide"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path d="M10.7 5.6A10.2 10.2 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a18.6 18.6 0 0 1-3.1 3.9M13.8 18.3A10.3 10.3 0 0 1 12 18.5C6 18.5 2.5 12 2.5 12a18.8 18.8 0 0 1 3-3.8" />
                <path d="m3.5 3.5 17 17" />
                <path d="M9.7 9.7a3.25 3.25 0 0 0 4.6 4.6" />
              </svg>
            </button>
          </div>
        </div>
        <Button className="oauth-submit" type="submit" size="lg">
          Continuar
        </Button>
        {emailAvailable ? (
          <button
            className="oauth-forgot-link"
            type="button"
            data-oauth-show="forgot"
          >
            ¿Olvidaste tu contraseña?
          </button>
        ) : null}
      </form>
      {tenantSlug ? (
        <>
          {allowEmailRegistration ? (
            <a className="oauth-account-action" href="/register">
              Crear una cuenta
            </a>
          ) : null}
          <div className="oauth-federated" data-social-login hidden>
            <div className="oauth-login-divider">
              <span>o continúa con</span>
            </div>
            <div
              className="oauth-provider-list"
              role="group"
              aria-label="Ingresar con una cuenta vinculada"
            >
              <Button
                className="oauth-provider"
                type="button"
                variant="outline"
                size="lg"
                aria-label="Continuar con Google"
                data-social-provider="google"
                hidden
              >
                <svg
                  className="oauth-provider-logo"
                  viewBox="0 0 48 48"
                  width="20"
                  height="20"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="#ea4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
                  />
                  <path
                    fill="#4285f4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
                  />
                  <path
                    fill="#fbbc05"
                    d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"
                  />
                  <path
                    fill="#34a853"
                    d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
                  />
                </svg>
                <span>Google</span>
              </Button>
              <Button
                className="oauth-provider"
                type="button"
                variant="outline"
                size="lg"
                aria-label="Continuar con Microsoft"
                data-social-provider="microsoft"
                hidden
              >
                <svg
                  className="oauth-provider-logo"
                  viewBox="0 0 21 21"
                  width="20"
                  height="20"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path fill="#f25022" d="M0 0h10v10H0z" />
                  <path fill="#7fba00" d="M11 0h10v10H11z" />
                  <path fill="#00a4ef" d="M0 11h10v10H0z" />
                  <path fill="#ffb900" d="M11 11h10v10H11z" />
                </svg>
                <span>Microsoft</span>
              </Button>
              <Button
                className="oauth-provider"
                type="button"
                variant="outline"
                size="lg"
                aria-label="Continuar con ChatGPT"
                data-social-provider="chatgpt"
                hidden
              >
                <span>ChatGPT</span>
              </Button>
            </div>
          </div>
          <section
            className="oauth-account-panel"
            data-oauth-panel="sso"
            hidden
          >
            <div className="oauth-heading oauth-heading-compact">
              <h2>Acceso de tu organización</h2>
              <p>
                Ingresa tu correo de trabajo para encontrar la conexión de tu
                organización.
              </p>
            </div>
            <form
              className="oauth-form"
              method="post"
              data-oauth-form="sso-discover"
            >
              <div className="oauth-field">
                <Label htmlFor="sso-email">Correo de trabajo</Label>
                <Input
                  id="sso-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </div>
              <Button className="oauth-submit" type="submit" size="lg">
                Continuar con SSO
              </Button>
            </form>
            <div className="oauth-account-actions" data-sso-connections />
            <p className="oauth-account-actions">
              <button type="button" data-oauth-show="login">
                Volver al inicio de sesión
              </button>
            </p>
          </section>
          <p
            className="oauth-account-actions"
            data-oauth-account-actions
            hidden={!!initialPanel}
          >
            <button
              className="oauth-enterprise-login"
              type="button"
              data-oauth-show="sso"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M2 21h20M9 21v-4h4v4M8 7h.01M14 7h.01M8 11h.01M14 11h.01" />
              </svg>
              <span>Ingresar con SSO</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
            </button>
          </p>
        </>
      ) : null}
      {emailAvailable ? (
        <section
          className="oauth-account-panel"
          data-oauth-panel="forgot"
          hidden={initialPanel !== "forgot"}
        >
          <div className="oauth-heading oauth-heading-compact">
            <h2>Recupera tu contraseña</h2>
            <p>
              Te enviaremos un enlace si el correo pertenece a una cuenta de
              Savia.
            </p>
          </div>
          <form
            className="oauth-form"
            action="request-password-reset"
            method="post"
            data-oauth-form="request-password-reset"
          >
            <div className="oauth-field">
              <Label htmlFor="recovery-email">Correo electrónico</Label>
              <Input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="nombre@empresa.com"
                required
              />
            </div>
            <Button className="oauth-submit" type="submit" size="lg">
              Enviar enlace de recuperación
            </Button>
          </form>
          <p className="oauth-account-actions">
            <button type="button" data-oauth-show="login">
              Volver al inicio de sesión
            </button>
          </p>
        </section>
      ) : null}
      <section
        className="oauth-account-panel"
        data-oauth-panel="verify"
        hidden={initialPanel !== "verify"}
      >
        <div className="oauth-heading oauth-heading-compact">
          <h2>Verifica tu correo</h2>
          <p>Confirma tu dirección para activar el acceso a tu cuenta.</p>
        </div>
        <form
          className="oauth-form"
          action="send-verification-email"
          method="post"
          data-oauth-form="send-verification-email"
        >
          <div className="oauth-field">
            <Label htmlFor="verification-email">Correo electrónico</Label>
            <Input
              id="verification-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nombre@empresa.com"
              required
            />
          </div>
          <Button className="oauth-submit" type="submit" size="lg">
            Reenviar enlace de verificación
          </Button>
        </form>
        <p className="oauth-account-actions">
          <button type="button" data-oauth-show="login">
            Volver al inicio de sesión
          </button>
        </p>
      </section>
      <section className="oauth-two-factor" data-oauth-two-factor hidden>
        <div className="oauth-heading oauth-heading-compact">
          <h2>Verificación en dos pasos</h2>
          <p>Confirma el código de tu aplicación autenticadora.</p>
        </div>
        <form
          className="oauth-form"
          action="verify-totp"
          method="post"
          data-oauth-form="verify-totp"
        >
          <div className="oauth-field">
            <Label htmlFor="totp-code">Código de autenticación</Label>
            <Input
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              required
            />
          </div>
          <Button className="oauth-submit" type="submit" size="lg">
            Verificar código
          </Button>
        </form>
        <details className="oauth-recovery">
          <summary>Usar un código de recuperación</summary>
          <form
            className="oauth-form"
            action="verify-backup-code"
            method="post"
            data-oauth-form="verify-backup-code"
          >
            <div className="oauth-field">
              <Label htmlFor="backup-code">Código de recuperación</Label>
              <Input
                id="backup-code"
                name="code"
                autoComplete="one-time-code"
                required
              />
            </div>
            <Button variant="outline" type="submit">
              Usar código de recuperación
            </Button>
          </form>
        </details>
      </section>
      <Status initialNotice={initialNotice} />
    </Shell>
  );
}

function EnrollmentContent({ branding }: { branding?: TenantBranding }) {
  return (
    <Shell screen="enroll" branding={branding}>
      <div className="oauth-heading">
        <p className="oauth-kicker">Protección de cuenta</p>
        <h1>Configura tu segundo factor</h1>
        <p>
          Las cuentas administradoras deben activar MFA antes de autorizar una
          aplicación.
        </p>
      </div>
      <form
        className="oauth-form"
        action="enable-totp"
        method="post"
        data-oauth-form="enable-totp"
      >
        <div className="oauth-field">
          <Label htmlFor="enrollment-password">Confirma tu contraseña</Label>
          <Input
            id="enrollment-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <Button className="oauth-submit" type="submit" size="lg">
          Generar código de configuración
        </Button>
      </form>
      <section className="oauth-enrollment" data-oauth-enrollment hidden>
        <p>Escanea este código QR con tu aplicación autenticadora:</p>
        <img
          className="oauth-totp-qr"
          data-oauth-totp-qr
          alt="Código QR para configurar MFA en Savia"
          hidden
        />
        <details className="oauth-manual-setup">
          <summary>Configurar manualmente</summary>
          <p>Agrega esta URI a tu aplicación autenticadora:</p>
          <code data-oauth-totp-uri />
        </details>
        <p>Guarda estos códigos de recuperación en un lugar seguro:</p>
        <ul data-oauth-backup-codes />
        <form
          className="oauth-form"
          action="verify-enrollment"
          method="post"
          data-oauth-form="verify-enrollment"
        >
          <div className="oauth-field">
            <Label htmlFor="enrollment-code">Código de autenticación</Label>
            <Input
              id="enrollment-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </div>
          <Button className="oauth-submit" type="submit" size="lg">
            Activar MFA y continuar
          </Button>
        </form>
      </section>
      <Status />
    </Shell>
  );
}

function ConsentContent({ branding }: { branding?: TenantBranding }) {
  return (
    <Shell screen="consent" branding={branding}>
      <div className="oauth-heading">
        <p className="oauth-kicker">Solicitud de acceso</p>
        <h1>Autoriza {branding?.displayName ?? "Savia"}</h1>
        <p data-oauth-client>La aplicación solicita acceso a tu cuenta.</p>
      </div>
      <div className="oauth-permissions">
        <p>Permisos solicitados</p>
        <ul data-oauth-scopes />
      </div>
      <form
        className="oauth-form"
        action="consent"
        method="post"
        data-oauth-form="consent"
      >
        <Button className="oauth-submit" type="submit" size="lg">
          Autorizar acceso
        </Button>
      </form>
      <Status />
    </Shell>
  );
}

function VerifiedContent({ branding }: { branding?: TenantBranding }) {
  return (
    <Shell screen="verified" branding={branding}>
      <div className="oauth-heading">
        <p className="oauth-kicker">Cuenta activada</p>
        <h1>Correo verificado</h1>
        <p>Tu correo está confirmado. Ya puedes iniciar sesión en Savia.</p>
      </div>
      <a className="oauth-action-link" href="/api/auth/login">
        Ir al inicio de sesión
      </a>
    </Shell>
  );
}

export function renderOAuthSurface(
  screen: Screen,
  options?: {
    tenantSlug?: string | null;
    branding?: TenantBranding;
    initialPanel?: "forgot" | "verify";
    initialNotice?: string;
    emailAvailable?: boolean;
    allowEmailRegistration?: boolean;
    verification?: { id: string; email: string; notice?: string };
  },
): string {
  const content =
    screen === "microsoft-verification" || screen === "chatgpt-verification" ? (
      <Shell screen="verified" branding={options?.branding}>
        <div className="oauth-heading">
          <p className="oauth-kicker">
            {screen === "chatgpt-verification" ? "ChatGPT" : "Microsoft"}
          </p>
          <h1>Verifica tu correo para continuar</h1>
          <p>
            Confirma que este correo te pertenece para acceder a tu equipo. Abre
            el enlace en este navegador.
          </p>
        </div>
        {options?.verification?.notice && (
          <p role="status">{options.verification.notice}</p>
        )}
        <form
          method="post"
          action={`/api/auth/${screen === "chatgpt-verification" ? "chatgpt" : "microsoft"}-email-verification/send`}
        >
          <input type="hidden" name="id" value={options?.verification?.id} />
          <Label htmlFor="verification-email">Correo electrónico</Label>
          <Input
            id="verification-email"
            name="email"
            type="email"
            defaultValue={options?.verification?.email}
            autoComplete="email"
            required
          />
          <Button type="submit">Enviar enlace de verificación</Button>
        </form>
        <a className="oauth-action-link" href="/api/auth/login">
          Volver al inicio de sesión
        </a>
      </Shell>
    ) : screen === "sso-complete" ? (
      <Shell screen="sso-complete" branding={options?.branding}>
        <section className="oauth-heading" data-sso-complete>
          <p className="oauth-kicker">
            {options?.branding?.displayName ?? "Savia"}
          </p>
          <h1>Completando inicio de sesión</h1>
          <p id="oauth-status" role="status">
            Validando tu acceso…
          </p>
          <a className="oauth-action-link" href="/api/auth/login">
            Volver al inicio de sesión
          </a>
        </section>
      </Shell>
    ) : screen === "login" ? (
      <LoginContent
        tenantSlug={options?.tenantSlug}
        branding={options?.branding}
        initialPanel={options?.initialPanel}
        initialNotice={options?.initialNotice}
        emailAvailable={options?.emailAvailable}
        allowEmailRegistration={options?.allowEmailRegistration}
      />
    ) : screen === "enroll" ? (
      <EnrollmentContent branding={options?.branding} />
    ) : screen === "consent" ? (
      <ConsentContent branding={options?.branding} />
    ) : (
      <VerifiedContent branding={options?.branding} />
    );
  return renderToStaticMarkup(content);
}
