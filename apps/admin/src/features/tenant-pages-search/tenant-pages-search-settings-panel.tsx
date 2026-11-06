import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useMessages } from "@/i18n/core";
import { tenantPagesSearchMessages } from "./messages";

type Settings = {
  tenantId: number;
  allowed: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  canGrant: boolean;
};

export function TenantPagesSearchSettingsPanel({
  services,
  tenantId,
}: {
  services: Pick<{ apiClient: ApiClient }, "apiClient">;
  tenantId: number;
}) {
  const t = useMessages(tenantPagesSearchMessages);
  const [settings, setSettings] = useState<Settings>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSettings(undefined);
    setError("");
    setNotice("");
    void services.apiClient
      .get<{ data: Settings }>(`/v1/tenants/${tenantId}/pages-search-settings`)
      .then(({ data }) => {
        if (active) setSettings(data);
      })
      .catch(() => {
        if (active) setError(t("Page search settings load failed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, services.apiClient, attempt, t]);

  async function save(patch: { allowed?: boolean; enabled?: boolean }) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await services.apiClient.put<{ data: Settings }>(
        `/v1/tenants/${tenantId}/pages-search-settings`,
        patch,
      );
      setSettings(data);
      setNotice(t("Page search settings saved"));
    } catch {
      setError(t("Page search settings save failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="grid gap-3"
      aria-labelledby={`page-search-title-${tenantId}`}
    >
      <header className="grid gap-1">
        <h2
          id={`page-search-title-${tenantId}`}
          className="text-base font-semibold"
        >
          {t("Page search")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("Page search settings description")}
        </p>
      </header>
      {loading ? (
        <div
          role="status"
          aria-label={t("Loading page search settings")}
          className="space-y-2"
        >
          <span className="sr-only">{t("Loading page search settings")}</span>
          <Skeleton className="h-12 w-full max-w-xl" />
          <Skeleton className="h-12 w-full max-w-xl" />
        </div>
      ) : error && !settings ? (
        <div className="grid justify-items-start gap-2">
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
      ) : settings ? (
        <div className="grid max-w-2xl gap-3">
          {settings.canGrant ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <label
                htmlFor={`page-search-grant-${tenantId}`}
                className="text-sm font-medium"
              >
                {t("Grant page search")}
              </label>
              <Switch
                id={`page-search-grant-${tenantId}`}
                checked={settings.allowed}
                disabled={busy}
                onCheckedChange={(allowed) => void save({ allowed })}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <label
              htmlFor={`page-search-enabled-${tenantId}`}
              className="text-sm font-medium"
            >
              {t("Enable page search")}
            </label>
            <Switch
              id={`page-search-enabled-${tenantId}`}
              checked={settings.enabled}
              disabled={busy || !settings.allowed}
              onCheckedChange={(enabled) => void save({ enabled })}
            />
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
        </div>
      ) : null}
    </section>
  );
}
