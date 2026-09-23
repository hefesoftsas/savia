import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { RecordHistoryUsage } from "./record-history-usage";
import { useEffect, useState } from "react";
import { getListObjectsQueryKey } from "./generated/crm";
import { useQueryClient } from "@tanstack/react-query";
import type { StudioObject } from "@savia/studio-shared/metadata";
import {
  isHistoryField,
  type RecordHistorySettings,
} from "@savia/studio-shared/record-history";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { collectionCapabilities } from "./collection-capabilities";
import {
  historyRequest,
  historyScope,
  supportsRecordHistory,
} from "./record-history-client";

type SettingsResponse = { data: RecordHistorySettings; version: number };
export default function RecordHistorySettingsButton({
  object,
}: {
  object: StudioObject;
}) {
  const t = useMessages(recordsMessages);

  const [open, setOpen] = useState(false);
  if (!supportsRecordHistory(object) || !collectionCapabilities(object).schema)
    return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("Configurar historial")}
      </Button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent
            className="max-h-[85dvh] overflow-y-auto"
            aria-describedby="history-settings-description"
          >
            <DialogHeader>
              <DialogTitle>
                {t("Historial de")} {object.label}
              </DialogTitle>
              <DialogDescription id="history-settings-description">
                {t(
                  "Selecciona los campos cuyos cambios quieres conservar. El seguimiento empieza al activarlo.",
                )}
              </DialogDescription>
            </DialogHeader>
            <SettingsForm
              key={`${historyScope()}:${object.name}`}
              object={object}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
function SettingsForm({ object }: { object: StudioObject }) {
  const t = useMessages(recordsMessages);

  const client = useQueryClient();
  const [settings, setSettings] = useState<SettingsResponse>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const path = `/record-history-settings/${encodeURIComponent(object.name)}`;
  useEffect(() => {
    const controller = new AbortController();
    setSettings(undefined);
    setError("");
    setSaved(false);
    historyRequest<SettingsResponse>(path, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSettings(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [path, reload]);
  const patch = (data: Partial<RecordHistorySettings>) => {
    setSaved(false);
    setSettings((v) => (v ? { ...v, data: { ...v.data, ...data } } : v));
  };
  if (!settings)
    return (
      <div>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={() => setReload((v) => v + 1)}>
              {t("Recargar configuración")}
            </Button>
          </div>
        ) : (
          <p role="status">{t("Cargando configuración…")}</p>
        )}
      </div>
    );
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        setSaved(false);
        try {
          const result = await historyRequest<SettingsResponse>(
            path,
            undefined,
            { ...settings.data, expectedVersion: settings.version },
          );
          setSettings(result);
          setSaved(true);
          await client.invalidateQueries({ queryKey: ["meta"] });
          await client.invalidateQueries({
            queryKey: getListObjectsQueryKey(),
          });
        } catch (e) {
          setSettings(undefined);
          setError(
            e instanceof Error
              ? e.message
              : t("No se pudo guardar la configuración."),
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving} className="grid gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.data.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          {t("Activar historial de cambios")}
        </label>
        <p className="text-sm text-muted-foreground">
          {t(
            "Al desactivarlo se detiene la captura. Los cambios guardados permanecen disponibles hasta su vencimiento original. La duración elegida se aplica a los próximos cambios.",
          )}
        </p>
        <label className="grid gap-2">
          {t("Días de conservación para nuevos cambios")}
          <Input
            type="number"
            min={1}
            max={365}
            required
            value={settings.data.retentionDays}
            onChange={(e) => patch({ retentionDays: e.target.valueAsNumber })}
          />
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium">
            {t("Campos a conservar (")}
            {settings.data.fields.length}/50)
          </legend>
          {Object.entries(object.config.fields)
            .filter(([name, field]) => isHistoryField(name, field))
            .map(([name, field]) => (
              <label key={name} className="flex min-w-0 items-start gap-2">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={settings.data.fields.includes(name)}
                  disabled={
                    !settings.data.fields.includes(name) &&
                    settings.data.fields.length >= 50
                  }
                  onChange={(e) =>
                    patch({
                      fields: e.target.checked
                        ? [...settings.data.fields, name]
                        : settings.data.fields.filter(
                            (value) => value !== name,
                          ),
                    })
                  }
                />
                <span className="break-words">{field.label ?? name}</span>
              </label>
            ))}
        </fieldset>
      </fieldset>
      <RecordHistoryUsage path={path} />
      {saved && <p role="status">{t("Configuración guardada.")}</p>}
      <Button
        type="submit"
        disabled={
          saving ||
          (settings.data.enabled && !settings.data.fields.length) ||
          !Number.isInteger(settings.data.retentionDays) ||
          settings.data.retentionDays < 1 ||
          settings.data.retentionDays > 365
        }
      >
        {saving ? t("Guardando…") : t("Guardar configuración")}
      </Button>
    </form>
  );
}
