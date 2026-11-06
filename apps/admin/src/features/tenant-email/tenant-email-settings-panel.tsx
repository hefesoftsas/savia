import { useEffect, useState, type FormEvent } from "react";
import { RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { useMessages } from "@/i18n/core";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tenantEmailMessages } from "./tenant-email-messages";

type Settings = {
  configured: boolean;
  host?: string;
  port?: number;
  username?: string;
  from?: string;
  security?: "tls" | "starttls";
  passwordConfigured?: boolean;
};

export function TenantEmailSettingsPanel({
  services,
  tenantId,
}: {
  services: Pick<{ apiClient: ApiClient }, "apiClient">;
  tenantId: number;
}) {
  const t = useMessages(tenantEmailMessages);
  const [settings, setSettings] = useState<Settings>();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [security, setSecurity] = useState<"tls" | "starttls">("starttls");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
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
    setHost("");
    setPort("587");
    setSecurity("starttls");
    setUsername("");
    setFrom("");
    setPassword("");
    try {
      void services.apiClient
        .get<Settings>(`/v1/tenants/${tenantId}/email-settings`)
        .then((response) => {
          if (!active) return;
          setSettings(response);
          setHost(response.host ?? "");
          setPort(String(response.port ?? 587));
          setSecurity(response.security ?? "starttls");
          setUsername(response.username ?? "");
          setFrom(response.from ?? "");
        })
        .catch(() => {
          if (active)
            setError(
              t("Email settings could not be loaded. Retry the request."),
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } catch {
      setError(t("Email settings could not be loaded. Retry the request."));
      setLoading(false);
    }
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
        `/v1/tenants/${tenantId}/email-settings`,
        {
          host,
          port: Number(port),
          security,
          username,
          password,
          from,
        },
      );
      setSettings(saved);
      setPassword("");
      setNotice(t("Email settings saved."));
    } catch {
      setError(
        t(
          "Email settings could not be saved. Check the server details and retry.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: "test" | "delete") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "test") {
        await services.apiClient.post(
          `/v1/tenants/${tenantId}/email-settings/test`,
        );
        setNotice(t("Test email sent to your account email."));
      } else {
        await services.apiClient.delete(
          `/v1/tenants/${tenantId}/email-settings`,
        );
        setSettings({ configured: false });
        setHost("");
        setPort("587");
        setSecurity("starttls");
        setUsername("");
        setPassword("");
        setFrom("");
        setNotice(t("Email settings removed."));
      }
    } catch {
      setError(
        action === "test"
          ? t(
              "Test email could not be sent. Check the saved server details and retry.",
            )
          : t("Email settings could not be removed. Retry the request."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="credentials-group"
      aria-labelledby="tenant-email-heading"
    >
      <header className="credentials-group-header">
        <h2 id="tenant-email-heading">{t("Tenant email delivery")}</h2>
        <p>
          {t(
            "Configure the SMTP server used for account messages such as password resets.",
          )}
        </p>
      </header>
      <div className="credentials-group-body">
        {loading ? (
          <div
            role="status"
            aria-label={t("Loading email settings…")}
            className="space-y-2 py-2"
          >
            <span className="sr-only">{t("Loading email settings…")}</span>
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
              className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RotateCcw aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t("Retry")}</span>
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              {settings?.configured
                ? t("Configured")
                : t("No email settings are configured for this tenant.")}
            </p>
            <form
              className="grid max-w-2xl gap-3 sm:grid-cols-2"
              onSubmit={save}
            >
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                {t("SMTP host")}
                <Input
                  autoComplete="off"
                  required
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                {t("Port")}
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  required
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                {t("Security")}
                <select
                  className="h-9 rounded-md border bg-background px-3"
                  value={security}
                  onChange={(event) =>
                    setSecurity(event.target.value as "tls" | "starttls")
                  }
                >
                  <option value="tls">{t("TLS")}</option>
                  <option value="starttls">{t("STARTTLS")}</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                {t("Username")}
                <Input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                {t("Password")}
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby="tenant-email-password-help"
                />
              </label>
              <p
                id="tenant-email-password-help"
                className="text-xs text-muted-foreground sm:col-span-2"
              >
                {t("Password is saved securely. Leave blank to keep it.")}
              </p>
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                {t("Sender email")}
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p role="status" className="text-sm sm:col-span-2">
                  {notice}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button
                  type="submit"
                  disabled={busy || settings === undefined}
                  className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
                >
                  <Save aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("Save email settings")}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !settings?.configured}
                  className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
                  onClick={() => void runAction("test")}
                >
                  <Send aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("Send test email")}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || !settings?.configured}
                  className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
                  onClick={() => void runAction("delete")}
                >
                  <Trash2 aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("Remove email settings")}
                  </span>
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
