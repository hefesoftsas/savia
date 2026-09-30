import { useEffect, useState, type FormEvent } from "react";
import { useMessages } from "@/i18n/core";
import { ApiClientError, type ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tenantSSOMessages } from "./tenant-sso-messages";

type Settings = {
  configured: boolean;
  displayName?: string;
  domain?: string;
  idpMetadata?: string;
  enabled?: boolean;
  ssoOnly?: boolean;
  providerId?: string;
  entityId?: string;
  acsUrl?: string;
  metadataUrl?: string;
};

export function TenantSSOSettingsPanel({
  services,
  tenantId,
}: {
  services: Pick<{ apiClient: ApiClient }, "apiClient">;
  tenantId: number;
}) {
  const t = useMessages(tenantSSOMessages);
  const [settings, setSettings] = useState<Settings>();
  const [displayName, setDisplayName] = useState("");
  const [domain, setDomain] = useState("");
  const [idpMetadata, setIdpMetadata] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [ssoOnly, setSsoOnly] = useState(false);
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
    setDisplayName("");
    setDomain("");
    setIdpMetadata("");
    setEnabled(false);
    setSsoOnly(false);
    void services.apiClient
      .get<Settings>(`/v1/tenants/${tenantId}/sso-settings`)
      .then((response) => {
        if (!active) return;
        setSettings(response);
        setDisplayName(response.displayName ?? "");
        setDomain(response.domain ?? "");
        setIdpMetadata(response.idpMetadata ?? "");
        setEnabled(response.enabled ?? false);
        setSsoOnly(response.ssoOnly ?? false);
      })
      .catch(() => {
        if (active)
          setError(t("SSO settings could not be loaded. Retry the request."));
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
        `/v1/tenants/${tenantId}/sso-settings`,
        { displayName, domain, idpMetadata, enabled, ssoOnly },
      );
      setSettings(saved);
      setIdpMetadata(saved.idpMetadata ?? idpMetadata);
      setNotice(t("SSO settings saved."));
    } catch (error) {
      setError(
        error instanceof ApiClientError && [400, 422].includes(error.status)
          ? error.message
          : t(
              "SSO settings could not be saved. Check the provider metadata and retry.",
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
      await services.apiClient.delete(`/v1/tenants/${tenantId}/sso-settings`);
      setSettings({ configured: false });
      setDisplayName("");
      setDomain("");
      setIdpMetadata("");
      setEnabled(false);
      setSsoOnly(false);
      setNotice(t("SSO settings removed."));
    } catch {
      setError(t("SSO settings could not be removed. Retry the request."));
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(settings?.configured);

  return (
    <section className="credentials-group" aria-labelledby="tenant-sso-heading">
      <header className="credentials-group-header">
        <h2 id="tenant-sso-heading">{t("Tenant SAML SSO")}</h2>
        <p>
          {t(
            "Allow members of this tenant to sign in through your identity provider.",
          )}
        </p>
      </header>
      <div className="credentials-group-body">
        {loading ? (
          <div
            role="status"
            aria-label={t("Loading SSO settings…")}
            className="space-y-2 py-2"
          >
            <span className="sr-only">{t("Loading SSO settings…")}</span>
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
                : t("No SAML provider is configured for this tenant.")}
            </p>
            <form className="grid max-w-3xl gap-3" onSubmit={save}>
              <label className="grid gap-1.5 text-sm">
                {t("Provider name")}
                <Input
                  autoComplete="off"
                  required
                  maxLength={100}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                {t("Email domain")}
                <Input
                  autoComplete="off"
                  required
                  maxLength={253}
                  pattern="(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  aria-describedby="tenant-sso-domain-help"
                />
                <span
                  id="tenant-sso-domain-help"
                  className="text-xs text-muted-foreground"
                >
                  {t(
                    "For example, company.example. The domain must be lowercase.",
                  )}
                </span>
              </label>
              <label className="grid gap-1.5 text-sm">
                {t("Identity provider metadata XML")}
                <Textarea
                  required
                  maxLength={102_400}
                  rows={8}
                  spellCheck={false}
                  className="font-mono text-xs"
                  value={idpMetadata}
                  onChange={(event) => setIdpMetadata(event.target.value)}
                  aria-describedby="tenant-sso-metadata-help"
                />
                <span
                  id="tenant-sso-metadata-help"
                  className="text-xs text-muted-foreground"
                >
                  {t(
                    "Paste the IdP metadata XML (up to 100 KiB). It contains public endpoints and certificates.",
                  )}
                </span>
              </label>
              <div className="grid gap-3 rounded-md border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={enabled}
                    onCheckedChange={(checked) => {
                      setEnabled(checked === true);
                      if (checked !== true) setSsoOnly(false);
                    }}
                    disabled={busy}
                  />
                  <span>{t("Enable SAML sign-in")}</span>
                </label>
                <div className="grid gap-1.5">
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={ssoOnly}
                      onCheckedChange={(checked) =>
                        setSsoOnly(checked === true)
                      }
                      disabled={busy || !enabled}
                    />
                    <span>{t("SSO-only sign-in")}</span>
                  </label>
                  <p className="pl-6 text-xs leading-relaxed text-muted-foreground">
                    {t(
                      "When enabled, tenant members cannot use a password sign-in or password reset. Only active, pre-provisioned users with a verified email can sign in through SAML. Platform administrators keep local recovery access.",
                    )}
                  </p>
                </div>
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
                <Button type="submit" disabled={busy || loading}>
                  {t("Save SSO settings")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || !configured}
                  onClick={() => void remove()}
                >
                  {t("Remove SSO settings")}
                </Button>
              </div>
            </form>
            {configured ? (
              <section
                className="mt-5 grid gap-2"
                aria-labelledby="tenant-sso-sp-heading"
              >
                <h3 id="tenant-sso-sp-heading" className="text-sm font-medium">
                  {t("Service provider details")}
                </h3>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Service provider entity ID", settings?.entityId],
                    ["Assertion consumer URL (ACS)", settings?.acsUrl],
                    ["Service provider metadata URL", settings?.metadataUrl],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        {t(label as keyof typeof tenantSSOMessages)}
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {value ?? "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
