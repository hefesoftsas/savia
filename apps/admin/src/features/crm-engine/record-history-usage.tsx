import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { historyRequest } from "./record-history-client";
type Usage = {
  events: number;
  logicalBytes: number;
  expiredEvents: number;
  oldestExpiredAt: string | null;
  limited: boolean;
  measuredAt: string;
};
export function RecordHistoryUsage({ path }: { path: string }) {
  const [requested, setRequested] = useState(0);
  const [data, setData] = useState<Usage>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    setBusy(true);
    setData(undefined);
    setError("");
    historyRequest<{ data: Usage }>(`${path}/usage`, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [path, requested]);
  return (
    <section
      className="grid gap-2 border-t pt-4"
      aria-label="Consumo del historial"
    >
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => setRequested((v) => v + 1)}
      >
        {busy ? "Midiendo…" : "Consultar consumo del historial"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Eventos conservados</dt>
            <dd>
              {data.limited ? "Al menos " : ""}
              {data.events.toLocaleString("es-CO")}
            </dd>
            <dt>Datos de cambios</dt>
            <dd>
              {data.limited ? "Al menos " : ""}
              {data.logicalBytes.toLocaleString("es-CO")} bytes
            </dd>
            <dt>Vencidos por limpiar</dt>
            <dd>
              {data.limited ? "Al menos " : ""}
              {data.expiredEvents.toLocaleString("es-CO")}
            </dd>
          </dl>
          {data.oldestExpiredAt && (
            <p className="text-sm">
              Vencimiento más antiguo {data.limited ? "en la muestra " : ""}:{" "}
              {new Date(data.oldestExpiredAt).toLocaleString("es-CO")}.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {data.limited
              ? "Medición parcial: se revisan hasta 1.000 eventos por consulta. "
              : ""}
            Bytes del contenido de cambios; excluye índices y otros datos. No es
            el almacenamiento facturado. Medido:{" "}
            {new Date(data.measuredAt).toLocaleString("es-CO")}.
          </p>
        </>
      )}
    </section>
  );
}
