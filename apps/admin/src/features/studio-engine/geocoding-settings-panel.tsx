import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CredentialDescriptionTooltip,
  formatConfiguredDate,
} from "@/features/service-credentials/credential-registry";
import { api } from "./api";

type GeocodingSettings = {
  geoapifyConfigured: boolean;
  geoapifyStored: boolean;
  updatedAt?: string | null;
};

export function GeocodingSettingsPanel() {
  const t = useMessages(studioMessages);
  const locale = useAppLocale();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const settings = useQuery({
    queryKey: ["geocoding-settings"],
    queryFn: () => api<GeocodingSettings>("/settings/geocoding"),
  });

  async function saveKey() {
    if (!apiKey.trim()) {
      toast.error(t("Indica la API key de Geoapify."));
      return;
    }
    setBusy(true);
    try {
      await api("/settings/geocoding", "PUT", {
        geoapifyApiKey: apiKey.trim(),
      });
      setApiKey("");
      await queryClient.invalidateQueries({ queryKey: ["geocoding-settings"] });
      toast.success(t("API key de Geoapify guardada"));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    try {
      await api("/settings/geocoding", "PUT", { clearGeoapifyApiKey: true });
      setApiKey("");
      await queryClient.invalidateQueries({ queryKey: ["geocoding-settings"] });
      toast.success(t("API key de Geoapify eliminada"));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="studio-fieldset">
      <legend>{t("Clave de Geoapify")}</legend>
      <p className="studio-field-help">
        {settings.data?.geoapifyConfigured
          ? settings.data.geoapifyStored
            ? t("Hay una clave guardada para este espacio.")
            : t("Geoapify está disponible mediante configuración del servidor.")
          : t("Geoapify requiere una API key gratuita.")}
      </p>
      <div className="flex items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          type="password"
          autoComplete="new-password"
          value={apiKey}
          placeholder={
            settings.data?.geoapifyStored
              ? t("•••••••••••••••• (dejar en blanco para conservar)")
              : t("Pega tu API key de Geoapify")
          }
          onChange={(event) => setApiKey(event.target.value)}
        />
        <CredentialDescriptionTooltip>
          {t("La clave se cifra en el servidor y no se devuelve al navegador.")}
        </CredentialDescriptionTooltip>
      </div>
      {settings.data?.geoapifyStored ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-200">
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {t("Clave de Geoapify guardada y cifrada")}
          </span>
          {settings.data.updatedAt ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              {t("• Configurada el")}{" "}
              {formatConfiguredDate(
                settings.data.updatedAt,
                intlLocale(locale),
              )}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="studio-inline-actions">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void saveKey()}
        >
          {t("Guardar clave")}
        </Button>
        {settings.data?.geoapifyStored ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void clearKey()}
          >
            {t("Quitar clave")}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
