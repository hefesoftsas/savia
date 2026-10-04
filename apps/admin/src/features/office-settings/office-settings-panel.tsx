import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMessages } from "@/i18n/core";
import { officeSettingsMessages } from "./messages";

type OfficeSettings = {
  tenantId: number;
  platformAllowed: boolean;
  tenantEnabled: boolean;
  enabled: boolean;
  canManagePlatform: boolean;
  canManageTenant: boolean;
};
type OfficeSettingsResponse = { data: OfficeSettings };
type ChangedSetting = "platformAllowed" | "tenantEnabled";

function withTimeout<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Office settings request timed out.")),
      15_000,
    );
    request.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function isSettingsResponse(
  response: OfficeSettingsResponse,
  tenantId: number,
): response is OfficeSettingsResponse {
  const value = response?.data;
  return (
    value?.tenantId === tenantId &&
    typeof value.platformAllowed === "boolean" &&
    typeof value.tenantEnabled === "boolean" &&
    typeof value.enabled === "boolean" &&
    typeof value.canManagePlatform === "boolean" &&
    typeof value.canManageTenant === "boolean"
  );
}

export function OfficeSettingsPanel({
  services,
  tenantId,
}: {
  services: { apiClient: ApiClient };
  tenantId: number;
}) {
  const t = useMessages(officeSettingsMessages);
  const tenantRef = useRef(tenantId);
  tenantRef.current = tenantId;
  const [settings, setSettings] = useState<OfficeSettings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const current = settings?.tenantId === tenantId ? settings : undefined;
  const path = `/v1/tenants/${tenantId}/office-settings`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSettings((value) => (value?.tenantId === tenantId ? value : undefined));
    setSaving(false);
    void withTimeout(
      Promise.resolve().then(() =>
        services.apiClient.get<OfficeSettingsResponse>(
          `/v1/tenants/${tenantId}/office-settings`,
        ),
      ),
    )
      .then((response) => {
        if (!active) return;
        if (!isSettingsResponse(response, tenantId))
          throw new Error("The office settings response is invalid.");
        setSettings(response.data);
      })
      .catch(() => {
        if (active) {
          setSettings(undefined);
          setError(
            t("Office suite settings could not be loaded. Retry the request."),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, services.apiClient, attempt, t]);

  async function change(key: ChangedSetting, value: boolean) {
    if (!current || saving || tenantRef.current !== tenantId) return;
    const scope = tenantId;
    setSaving(true);
    setError("");
    try {
      const response = await withTimeout(
        services.apiClient.patch<OfficeSettingsResponse>(path, {
          [key]: value,
        }),
      );
      if (tenantRef.current !== scope) return;
      if (!isSettingsResponse(response, scope))
        throw new Error("The office settings response is invalid.");
      setSettings(response.data);
      window.dispatchEvent(new Event("savia:office-settings-changed"));
    } catch {
      if (tenantRef.current === scope)
        setError(
          t("Office suite settings could not be saved. Retry the request."),
        );
    } finally {
      if (tenantRef.current === scope) setSaving(false);
    }
  }

  return (
    <section
      className="credentials-group"
      aria-labelledby="office-settings-heading"
    >
      <header className="credentials-group-header">
        <h2 id="office-settings-heading">{t("Office suite settings")}</h2>
        <p>
          {t("Manage whether the office suite is available to this tenant.")}
        </p>
      </header>
      <div className="credentials-group-body">
        {loading || !current ? (
          error ? (
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
            <p role="status" aria-label={t("Loading office suite settings…")}>
              {t("Loading office suite settings…")}
            </p>
          )
        ) : (
          <div className="grid max-w-3xl gap-4">
            {current.canManagePlatform ? (
              <div className="grid gap-2">
                <Label htmlFor="office-platform-allowed">
                  {t("Allow office suite for this tenant")}
                </Label>
                <Switch
                  id="office-platform-allowed"
                  checked={current.platformAllowed}
                  onCheckedChange={(value) =>
                    void change("platformAllowed", value)
                  }
                  disabled={saving}
                />
              </div>
            ) : null}
            {!current.platformAllowed ? (
              <p className="text-sm text-muted-foreground" role="note">
                {t("Office suite is disabled by the platform administrator.")}
              </p>
            ) : null}
            {current.canManageTenant ? (
              <div className="grid gap-2">
                <Label htmlFor="office-tenant-enabled">
                  {t("Enable office suite for this tenant")}
                </Label>
                <Switch
                  id="office-tenant-enabled"
                  checked={current.tenantEnabled}
                  onCheckedChange={(value) =>
                    void change("tenantEnabled", value)
                  }
                  disabled={saving || !current.platformAllowed}
                />
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground" role="note">
              {t("Existing documents are preserved when access is disabled.")}
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
