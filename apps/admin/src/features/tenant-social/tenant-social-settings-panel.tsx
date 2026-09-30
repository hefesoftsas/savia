import { useEffect, useState, type FormEvent } from "react";
import { useMessages } from "@/i18n/core";
import { ApiClientError, type ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { tenantSocialMessages } from "./tenant-social-messages";

type Settings = {
  configured: boolean;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
  allowRegistration: boolean;
  microsoftTenantId: string;
  googleAvailable: boolean;
  microsoftAvailable: boolean;
  googleCallbackUrl: string;
  microsoftCallbackUrl: string;
};

const emptySettings: Settings = {
  configured: false,
  googleEnabled: false,
  microsoftEnabled: false,
  allowRegistration: false,
  microsoftTenantId: "",
  googleAvailable: false,
  microsoftAvailable: false,
  googleCallbackUrl: "",
  microsoftCallbackUrl: "",
};

export function TenantSocialSettingsPanel({
  services,
  tenantId,
}: {
  services: Pick<{ apiClient: ApiClient }, "apiClient">;
  tenantId: number;
}) {
  const t = useMessages(tenantSocialMessages);
  const [settings, setSettings] = useState<Settings>();
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [microsoftTenantId, setMicrosoftTenantId] = useState("");
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
    setGoogleEnabled(false);
    setMicrosoftEnabled(false);
    setAllowRegistration(false);
    setMicrosoftTenantId("");
    void services.apiClient
      .get<Settings>(`/v1/tenants/${tenantId}/social-settings`)
      .then((response) => {
        if (!active) return;
        setSettings(response);
        setGoogleEnabled(response.googleEnabled);
        setMicrosoftEnabled(response.microsoftEnabled);
        setAllowRegistration(response.allowRegistration ?? false);
        setMicrosoftTenantId(response.microsoftTenantId);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              "Social sign-in settings could not be loaded. Retry the request.",
            ),
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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await services.apiClient.put<Settings>(
        `/v1/tenants/${tenantId}/social-settings`,
        {
          googleEnabled,
          microsoftEnabled,
          microsoftTenantId: microsoftTenantId.trim(),
          allowRegistration,
        },
      );
      setSettings(saved);
      setGoogleEnabled(saved.googleEnabled);
      setMicrosoftEnabled(saved.microsoftEnabled);
      setAllowRegistration(saved.allowRegistration ?? false);
      setMicrosoftTenantId(saved.microsoftTenantId);
      setNotice(t("Social sign-in settings saved."));
    } catch (caught) {
      setError(
        caught instanceof ApiClientError && [400, 422].includes(caught.status)
          ? caught.message
          : t(
              "Social sign-in settings could not be saved. Check the Microsoft tenant ID and retry.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await services.apiClient.delete(
        `/v1/tenants/${tenantId}/social-settings`,
      );
      const result = {
        ...emptySettings,
        ...settings,
        configured: false,
        googleEnabled: false,
        microsoftEnabled: false,
        allowRegistration: false,
        microsoftTenantId: "",
      };
      setSettings(result);
      setGoogleEnabled(false);
      setMicrosoftEnabled(false);
      setAllowRegistration(false);
      setMicrosoftTenantId("");
      setNotice(t("Social sign-in settings removed."));
    } catch {
      setError(
        t("Social sign-in settings could not be removed. Retry the request."),
      );
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(settings?.configured);
  const current = settings ?? emptySettings;

  return (
    <section
      className="credentials-group"
      aria-labelledby="tenant-social-heading"
    >
      <header className="credentials-group-header">
        <h2 id="tenant-social-heading">{t("Social sign-in")}</h2>
        <p>{t("Let tenant members use Google or Microsoft to sign in.")}</p>
      </header>
      <div className="credentials-group-body">
        {loading ? (
          <div
            role="status"
            aria-label={t("Loading social sign-in settings…")}
            className="space-y-2 py-2"
          >
            <span className="sr-only">
              {t("Loading social sign-in settings…")}
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
        ) : (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              {configured
                ? t("Configured")
                : t("No social sign-in providers are enabled for this tenant.")}
            </p>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t(
                "Provider credentials are configured by your deployment administrator. You can enable a provider when it is available.",
              )}
            </p>
            <form className="grid max-w-3xl gap-3" onSubmit={save}>
              <div className="grid gap-3 rounded-md border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={googleEnabled}
                    onCheckedChange={(checked) =>
                      setGoogleEnabled(checked === true)
                    }
                    disabled={
                      busy || (!current.googleAvailable && !googleEnabled)
                    }
                    aria-describedby="tenant-social-google-availability"
                  />
                  <span>{t("Enable Google sign-in")}</span>
                </label>
                <p
                  id="tenant-social-google-availability"
                  className="break-all pl-6 text-xs leading-relaxed text-muted-foreground"
                >
                  {current.googleAvailable
                    ? current.googleCallbackUrl
                      ? `${t("Google callback URL")}: ${current.googleCallbackUrl}`
                      : ""
                    : t(
                        "Google credentials are not available in this deployment.",
                      )}
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={microsoftEnabled}
                    onCheckedChange={(checked) =>
                      setMicrosoftEnabled(checked === true)
                    }
                    disabled={
                      busy || (!current.microsoftAvailable && !microsoftEnabled)
                    }
                    aria-describedby="tenant-social-microsoft-availability"
                  />
                  <span>{t("Enable Microsoft sign-in")}</span>
                </label>
                <p
                  id="tenant-social-microsoft-availability"
                  className="break-all pl-6 text-xs leading-relaxed text-muted-foreground"
                >
                  {current.microsoftAvailable
                    ? current.microsoftCallbackUrl
                      ? `${t("Microsoft callback URL")}: ${current.microsoftCallbackUrl}`
                      : ""
                    : t(
                        "Microsoft credentials are not available in this deployment.",
                      )}
                </p>
              </div>
              <label className="grid max-w-xl gap-1.5 text-sm">
                {t("Microsoft Entra tenant ID")}
                <Input
                  aria-label={t("Microsoft Entra tenant ID")}
                  autoComplete="off"
                  inputMode="text"
                  pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                  value={microsoftTenantId}
                  onChange={(event) => setMicrosoftTenantId(event.target.value)}
                  disabled={
                    busy || !current.microsoftAvailable || !microsoftEnabled
                  }
                  required={microsoftEnabled}
                  aria-describedby="tenant-social-tenant-id-help"
                />
                <span
                  id="tenant-social-tenant-id-help"
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  {t(
                    "Enter the UUID of your Microsoft Entra directory. Personal Microsoft accounts are not supported.",
                  )}
                </span>
              </label>
              <div className="grid gap-2 border-t pt-3">
                <label className="flex items-start gap-3 text-sm">
                  <Switch
                    checked={allowRegistration}
                    onCheckedChange={setAllowRegistration}
                    disabled={busy}
                    aria-describedby="tenant-social-registration-help"
                  />
                  <span>{t("Create new users through federated sign-in")}</span>
                </label>
                <p
                  id="tenant-social-registration-help"
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  {t(
                    "When disabled, an administrator must create users before they can sign in. When enabled, anyone with a provider-verified email from an enabled provider can join, subject to this tenant's user limit.",
                  )}
                </p>
                <p className="text-sm">
                  <strong>{t("Initial access: Viewer")}</strong>
                  {` — ${t("the minimum role; federated sign-in cannot grant administrator access.")}`}
                </p>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p role="status" className="text-sm">
                  {notice}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    loading ||
                    (!googleEnabled &&
                      !microsoftEnabled &&
                      !configured &&
                      !allowRegistration)
                  }
                >
                  {t("Save social sign-in settings")}
                </Button>
                {configured ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {t("Remove social sign-in settings")}
                  </Button>
                ) : null}
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
