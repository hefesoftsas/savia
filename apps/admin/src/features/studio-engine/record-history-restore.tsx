import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect, useState } from "react";
import type { StudioObject } from "@savia/studio-shared/metadata";
import type { RecordHistoryDetail } from "@savia/studio-shared/record-history";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { historyRequest } from "./record-history-client";

type Preview = {
  expectedVersion: number;
  changes: Record<
    string,
    RecordHistoryDetail["changes"][string] & { current?: unknown }
  >;
};
const show = (
  v: unknown,
  t: ReturnType<typeof useMessages<typeof recordsMessages>>,
) =>
  v === undefined
    ? t("No disponible")
    : v === null
      ? t("Sin valor")
      : typeof v === "boolean"
        ? v
          ? t("Sí")
          : t("No")
        : String(v);
export function RecordHistoryRestore({
  object,
  path,
  onClose,
  onRestored,
}: {
  object: StudioObject;
  path: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const t = useMessages(recordsMessages);

  const [preview, setPreview] = useState<Preview>();
  const [fields, setFields] = useState<string[]>([]);
  const [side, setSide] = useState<"before" | "after">("before");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(undefined);
    setFields([]);
    setError("");
    historyRequest<{ data: Preview }>(path, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setPreview(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [path, reload]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Restaurar campos")}</DialogTitle>
          <DialogDescription>
            {t(
              "Compara con el registro actual y selecciona los campos. Se guardará una nueva edición; los demás campos se conservarán. Requiere conexión y sincronización sin pendientes.",
            )}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div role="alert" className="grid gap-2">
            <p>{error}</p>
            <Button variant="outline" onClick={() => setReload((v) => v + 1)}>
              {t("Revisar comparación de nuevo")}
            </Button>
          </div>
        )}
        {!preview ? (
          !error && <p role="status">{t("Preparando comparación…")}</p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || !fields.length) return;
              setBusy(true);
              setError("");
              try {
                await historyRequest(path, undefined, {
                  expectedVersion: preview.expectedVersion,
                  side,
                  fields,
                });
                onRestored();
              } catch (e) {
                setPreview(undefined);
                setFields([]);
                setError(
                  e instanceof Error
                    ? e.message
                    : t(
                        "No se pudo confirmar la restauración. Revisa el registro antes de reintentar.",
                      ),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy} className="grid gap-3">
              <label className="grid gap-2">
                {t("Valores a recuperar")}
                <select
                  className="rounded-md border bg-background p-2"
                  value={side}
                  onChange={(e) => {
                    setSide(e.target.value as "before" | "after");
                    setFields([]);
                  }}
                >
                  <option value="before">{t("Antes del cambio")}</option>
                  <option value="after">{t("Después del cambio")}</option>
                </select>
              </label>
              {!Object.keys(preview.changes).length && (
                <p>{t("No hay campos que puedas restaurar en este cambio.")}</p>
              )}
              {Object.entries(preview.changes).map(([name, change]) => {
                const available =
                  Object.hasOwn(change, side) &&
                  !change[
                    side === "before" ? "beforeTruncated" : "afterTruncated"
                  ];
                return (
                  <section key={name} className="grid gap-2 border-b pb-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!available}
                        checked={fields.includes(name)}
                        onChange={(e) =>
                          setFields((v) =>
                            e.target.checked
                              ? [...v, name]
                              : v.filter((f) => f !== name),
                          )
                        }
                      />
                      {object.config.fields[name]?.label ?? name}
                    </label>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-sm text-muted-foreground">
                          {t("Actual")}
                        </dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {show(change.current, t)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-sm text-muted-foreground">
                          {t("Valor a recuperar")}
                        </dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {available
                            ? show(change[side], t)
                            : t("No restaurable: valor ausente o truncado.")}
                        </dd>
                      </div>
                    </dl>
                  </section>
                );
              })}
            </fieldset>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                {t("Cancelar")}
              </Button>
              <Button disabled={busy || !fields.length} type="submit">
                {busy ? t("Restaurando…") : t("Confirmar restauración")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
