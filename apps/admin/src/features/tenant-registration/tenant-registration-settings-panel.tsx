import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiClientError, type ApiClient } from "@/api/api-client";
import { useMessages } from "@/i18n/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { tenantRegistrationMessages } from "./tenant-registration-messages";

type CaptchaMode = "inherit" | "tenant";
type CaptchaProvider = "turnstile" | "altcha";
type Settings = {
  allowEmailRegistration: boolean;
  captchaMode: CaptchaMode;
  siteKey: string;
  secretConfigured: boolean;
  emailReady: boolean;
  revision: string;
  captchaProvider: CaptchaProvider;
  captchaReady: boolean;
  registrationReady: boolean;
  passwordAllowed?: boolean;
};

type SaveSettings = {
  allowEmailRegistration: boolean;
  captchaMode: CaptchaMode;
  siteKey?: string;
  secretKey?: string | null;
};

export function TenantRegistrationSettingsPanel({
  services,
  tenantId,
}: {
  services: Pick<{ apiClient: ApiClient }, "apiClient">;
  tenantId: number;
}) {
  const t = useMessages(tenantRegistrationMessages);
  const [settings, setSettings] = useState<Settings>();
  const [allowEmailRegistration, setAllowEmailRegistration] = useState(false);
  const [captchaMode, setCaptchaMode] = useState<CaptchaMode>("inherit");
  const [siteKey, setSiteKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNotice("");
    setSettings(undefined);
    setAllowEmailRegistration(false);
    setCaptchaMode("inherit");
    setSiteKey("");
    setSecretKey("");
    setRemoveSecret(false);
    void services.apiClient
      .get<Settings>(`/v1/tenants/${tenantId}/registration-settings`)
      .then((response) => {
        if (!active) return;
        setSettings(response);
        setAllowEmailRegistration(response.allowEmailRegistration);
        setCaptchaMode(response.captchaMode);
        setSiteKey(response.siteKey);
      })
      .catch(() => {
        if (active)
          setError(
            t("Registration settings could not be loaded. Retry the request."),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, services.apiClient, attempt, t]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    if (allowEmailRegistration && settings.passwordAllowed === false) {
      setError(
        t(
          "Password registration is unavailable because this organization is inactive or requires SSO-only sign-in.",
        ),
      );
      return;
    }
    if (
      allowEmailRegistration &&
      (!settings.emailReady || !settings.captchaReady)
    ) {
      setError(
        t(
          "Configure email delivery and a ready CAPTCHA before enabling registration.",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const body: SaveSettings = {
      allowEmailRegistration,
      captchaMode:
        settings.captchaProvider === "altcha" ? "inherit" : captchaMode,
    };
    if (settings.captchaProvider === "turnstile" && captchaMode === "tenant") {
      body.siteKey = siteKey.trim();
      if (removeSecret) body.secretKey = null;
      else if (secretKey.trim()) body.secretKey = secretKey.trim();
    } else if (settings.captchaProvider === "turnstile" && removeSecret) {
      body.secretKey = null;
    }
    try {
      const saved = await services.apiClient.put<Settings>(
        `/v1/tenants/${tenantId}/registration-settings`,
        body,
      );
      setSettings(saved);
      setAllowEmailRegistration(saved.allowEmailRegistration);
      setCaptchaMode(saved.captchaMode);
      setSiteKey(saved.siteKey);
      setSecretKey("");
      setRemoveSecret(false);
      setNotice(t("Registration settings saved."));
    } catch (caught) {
      setError(
        caught instanceof ApiClientError && [400, 422].includes(caught.status)
          ? caught.message
          : t(
              "Registration settings could not be saved. Check the requirements and retry.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  const readiness =
    settings?.registrationReady && settings.emailReady && settings.captchaReady;
  const passwordAllowed = settings?.passwordAllowed !== false;
  const activationDisabled =
    busy || (!allowEmailRegistration && (!readiness || !passwordAllowed));

  return (
    <section
      className="credentials-group"
      aria-labelledby="tenant-registration-heading"
    >
      <header className="credentials-group-header">
        <h2 id="tenant-registration-heading">{t("User registration")}</h2>
        <p>
          {t(
            "Let people create a tenant account with an email address and password.",
          )}
        </p>
      </header>
      <div className="credentials-group-body">
        {loading ? (
          <div
            role="status"
            aria-label={t("Loading registration settings…")}
            className="space-y-2 py-2"
          >
            <span className="sr-only">
              {t("Loading registration settings…")}
            </span>
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-9 w-full max-w-md animate-pulse rounded bg-muted" />
          </div>
        ) : error && !settings ? (
          <div className="grid gap-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : settings ? (
          <>
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div className="grid gap-1">
                  <label
                    htmlFor="tenant-email-registration"
                    className="text-sm font-medium"
                  >
                    {t("Allow registration with email and password")}
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "This setting is separate from Google and Microsoft registration.",
                    )}
                  </p>
                </div>
                <Switch
                  id="tenant-email-registration"
                  checked={allowEmailRegistration}
                  disabled={activationDisabled}
                  onCheckedChange={setAllowEmailRegistration}
                />
              </div>
              {settings.passwordAllowed === false ? (
                <p className="text-sm text-destructive" role="status">
                  {t(
                    "Password registration is unavailable because this organization is inactive or requires SSO-only sign-in.",
                  )}
                </p>
              ) : !settings.captchaReady ? (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Save CAPTCHA credentials while registration is off, then enable it after email and CAPTCHA are ready.",
                  )}
                </p>
              ) : null}
              <div className="rounded-md border p-3 text-sm">
                <strong>{t("Initial access: Viewer")}</strong>
                <p className="mt-1 text-muted-foreground">
                  {t(
                    "New members receive the Viewer role and count toward this tenant's user limit.",
                  )}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <div className="grid gap-1">
                <h3 className="text-sm font-semibold">{t("Email delivery")}</h3>
                <p
                  className={
                    settings.emailReady
                      ? "text-sm text-muted-foreground"
                      : "text-sm text-destructive"
                  }
                  role="status"
                >
                  {settings.emailReady
                    ? t("Email delivery is ready.")
                    : t("No email delivery is configured.")}
                </p>
                <Link
                  className="w-fit text-sm text-primary underline-offset-4 hover:underline"
                  to={`/service-credentials?tenantId=${tenantId}&tab=email`}
                >
                  {t("Configure email delivery")}
                </Link>
              </div>

              <div className="grid gap-3">
                <div className="grid gap-1">
                  <h3 className="text-sm font-semibold">
                    {t("Registration protection")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {settings.captchaProvider === "altcha"
                      ? t("ALTCHA is verified locally by this server.")
                      : t("Turnstile protects the public registration form.")}
                  </p>
                  <p
                    className={
                      settings.captchaReady
                        ? "text-sm text-muted-foreground"
                        : "text-sm text-destructive"
                    }
                    role="status"
                  >
                    {settings.captchaReady
                      ? t("CAPTCHA is ready.")
                      : t("CAPTCHA is not ready.")}
                  </p>
                </div>
                {settings.captchaProvider === "altcha" ? null : (
                  <>
                    <label className="grid max-w-md gap-1.5 text-sm">
                      {t("CAPTCHA credentials")}
                      <select
                        className="h-9 rounded-md border bg-background px-3"
                        value={captchaMode}
                        onChange={(event) =>
                          setCaptchaMode(event.target.value as CaptchaMode)
                        }
                        disabled={busy}
                      >
                        <option value="inherit">
                          {t("Use deployment credentials")}
                        </option>
                        <option value="tenant">
                          {t("Use tenant credentials")}
                        </option>
                      </select>
                    </label>
                    {captchaMode === "tenant" ? (
                      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
                        <label className="grid gap-1.5 text-sm sm:col-span-2">
                          {t("Turnstile site key")}
                          <Input
                            autoComplete="off"
                            value={siteKey}
                            onChange={(event) => setSiteKey(event.target.value)}
                            disabled={busy}
                          />
                        </label>
                        <label className="grid gap-1.5 text-sm sm:col-span-2">
                          {t("Replace Turnstile secret")}
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={secretKey}
                            onChange={(event) =>
                              setSecretKey(event.target.value)
                            }
                            disabled={busy}
                            aria-describedby="tenant-registration-secret-help"
                          />
                        </label>
                        <p
                          id="tenant-registration-secret-help"
                          className="text-sm text-muted-foreground sm:col-span-2"
                        >
                          {settings.secretConfigured
                            ? t(
                                "A secret is saved. Leave this field blank to keep it.",
                              )
                            : t(
                                "The secret is encrypted and never shown again.",
                              )}
                        </p>
                      </div>
                    ) : null}
                    {settings.secretConfigured ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        className="w-fit"
                        onClick={() => {
                          setRemoveSecret((value) => !value);
                          setSecretKey("");
                        }}
                      >
                        {removeSecret
                          ? t("Keep saved secret")
                          : t("Remove saved secret")}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {notice}
              </p>
            ) : null}
            <form className="mt-4" onSubmit={save}>
              <Button type="submit" disabled={busy}>
                {busy ? t("Saving…") : t("Save registration settings")}
              </Button>
            </form>
          </>
        ) : null}
      </div>
    </section>
  );
}
