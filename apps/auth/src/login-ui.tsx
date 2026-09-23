import * as React from "react";
import type { TenantBranding } from "@savia/tenant-host/branding";
import { renderToStaticMarkup } from "react-dom/server";
import { saviaLargeLogoDataUri, saviaLogoDataUri } from "./savia-logo";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

type Screen = "login" | "enroll" | "consent";

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
        : "Acceso seguro";
  const showLoginAnimation = screen === "login" && !branding?.coverUrl;
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
        className={`oauth-aside${branding?.coverUrl ? " has-cover" : ""}${showLoginAnimation ? " has-login-animation" : ""}`}
        aria-label={showLoginAnimation ? "Animación de Savia" : undefined}
        aria-hidden={showLoginAnimation ? undefined : "true"}
      >
        {branding?.coverUrl && (
          <img className="oauth-aside-cover" src={branding.coverUrl} alt="" />
        )}
        {showLoginAnimation ? (
          <div className="oauth-login-animation" data-oauth-login-animation>
            <div
              className="oauth-login-animation-frame"
              data-oauth-login-animation-frame
              data-src="/login/savia-logo.json"
            />
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
            <p
              className="oauth-login-animation-wordmark"
              data-oauth-login-wordmark
              aria-label="Savia"
            >
              <span>sav</span>
              <span data-oauth-login-wordmark-ai>ia</span>
            </p>
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

function Status() {
  return <p id="oauth-status" role="status" aria-live="polite" />;
}

function LoginContent({
  tenantSlug,
  branding,
}: { tenantSlug?: string | null; branding?: TenantBranding } = {}) {
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
      </form>
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
      <Status />
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

export function renderOAuthSurface(
  screen: Screen,
  options?: { tenantSlug?: string | null; branding?: TenantBranding },
): string {
  const content =
    screen === "login" ? (
      <LoginContent
        tenantSlug={options?.tenantSlug}
        branding={options?.branding}
      />
    ) : screen === "enroll" ? (
      <EnrollmentContent branding={options?.branding} />
    ) : (
      <ConsentContent branding={options?.branding} />
    );
  return renderToStaticMarkup(content);
}
