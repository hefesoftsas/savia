import { intlLocale, useAppLocale } from "@/i18n/core";
import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { RecordHistoryRestore } from "./record-history-restore";
import { collectionCapabilities } from "./collection-capabilities";
import { useEffect, useState } from "react";
import type { CrmObject } from "@savia/crm-shared/metadata";
import type {
  RecordHistoryPage,
  RecordHistoryDetail,
  RecordHistoryEntry,
} from "@savia/crm-shared/record-history";
import { Button } from "@/components/ui/button";
import { historyRequest, historyScope } from "./record-history-client";

const actions = {
  created: "Registro creado",
  updated: "Registro actualizado",
  deleted: "Registro eliminado",
  restored: "Registro restaurado",
} as const;
const actors = {
  user: "Usuario",
  workflow: "Flujo",
  "public-form": "Formulario público",
  system: "Sistema",
} as const;
const value = (
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
export default function RecordHistory(props: {
  object: CrmObject;
  recordId: string;
  onRestored?: () => void;
}) {
  return (
    <HistorySession
      key={`${historyScope()}:${props.object.name}:${props.recordId}`}
      {...props}
    />
  );
}
function HistorySession({
  object,
  recordId,
  onRestored,
}: {
  object: CrmObject;
  recordId: string;
  onRestored?: () => void;
}) {
  const uiLocale = intlLocale(useAppLocale());

  const t = useMessages(recordsMessages);

  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<RecordHistoryPage>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<RecordHistoryEntry>();
  const [detail, setDetail] = useState<RecordHistoryDetail>();
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const cursor = cursors.at(-1);
  const base = `/record-history/${encodeURIComponent(object.name)}/${encodeURIComponent(recordId)}`;
  useEffect(() => {
    const controller = new AbortController();
    setPage(undefined);
    setError("");
    setSelected(undefined);
    setDetail(undefined);
    setDetailError("");
    historyRequest<RecordHistoryPage>(
      `${base}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [base, cursor, refresh]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail(undefined);
    setDetailError("");
    historyRequest<{ data: RecordHistoryDetail }>(
      `${base}/${selected.version}`,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setDetailError(e.message);
          if (e.status === 401 || e.status === 403) {
            setPage(undefined);
            setError(e.message);
            setSelected(undefined);
          }
        }
      });
    return () => controller.abort();
  }, [base, selected, detailRetry]);
  const newest = () => {
    setPage(undefined);
    setDetail(undefined);
    setSelected(undefined);
    setCursors([null]);
    setRefresh((v) => v + 1);
  };
  return (
    <section aria-label={t("Historial del registro")} className="grid gap-4">
      {restored && (
        <p role="status">
          {t("Campos restaurados. Se guardó una nueva edición.")}
        </p>
      )}
      {restoring && selected && (
        <RecordHistoryRestore
          object={object}
          path={`${base}/${selected.version}/restore`}
          onClose={() => setRestoring(false)}
          onRestored={() => {
            setRestoring(false);
            setRestored(true);
            newest();
            onRestored?.();
          }}
        />
      )}
      <div className="op-section-title">
        <div>
          <h3>{t("Historial de cambios")}</h3>
          <p>
            {t("Valores de los campos seleccionados al guardar cada cambio.")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={newest}>
          {t("Actualizar historial")}
        </Button>
      </div>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={newest}>
            {t("Reintentar")}
          </Button>
        </div>
      ) : !page ? (
        <p role="status">{t("Cargando historial…")}</p>
      ) : (
        <>
          <p className="op-muted">
            {t("Conservación para nuevos cambios:")} {page.retentionDays}{" "}
            {t("días.")}{" "}
            {!page.enabled &&
              t(
                "La captura está desactivada; los cambios guardados se conservan hasta su vencimiento.",
              )}
          </p>
          {!page.data.length ? (
            <div className="op-empty">
              {t(
                "No hay cambios conservados. El seguimiento empieza al activarlo y no incluye cambios anteriores.",
              )}
            </div>
          ) : (
            <ol className="op-timeline">
              {page.data.map((entry) => (
                <li key={entry.version}>
                  <div>
                    <strong>{t(actions[entry.action])}</strong>
                    <time dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString(uiLocale)}
                    </time>
                  </div>
                  <p>
                    {t(actors[entry.actor.kind])} ·{" "}
                    {entry.actor.id ?? t("Autor no disponible")}{" "}
                    {t("· Versión")} {entry.version}
                  </p>
                  <p className="break-words">
                    {entry.fields.length
                      ? entry.fields
                          .map(
                            (name) => object.config.fields[name]?.label ?? name,
                          )
                          .join(", ")
                      : t("Sin cambios de campos visibles.")}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={selected?.version === entry.version}
                    onClick={() => {
                      setDetail(undefined);
                      setDetailError("");
                      setSelected(
                        selected?.version === entry.version ? undefined : entry,
                      );
                    }}
                  >
                    {t("Ver cambios · versión")} {entry.version}
                  </Button>
                  {selected?.version === entry.version && (
                    <section
                      className="mt-3 grid gap-3"
                      aria-label={t("Cambios de versión %{p0}", {
                        p0: entry.version,
                      })}
                    >
                      {detail && collectionCapabilities(object).update && (
                        <Button
                          variant="outline"
                          onClick={() => setRestoring(true)}
                        >
                          {t("Restaurar campos")}
                        </Button>
                      )}
                      {detailError ? (
                        <div role="alert">
                          <p>{detailError}</p>
                          <Button
                            variant="outline"
                            onClick={() => setDetailRetry((v) => v + 1)}
                          >
                            {t("Reintentar detalle")}
                          </Button>
                        </div>
                      ) : !detail ? (
                        <p role="status">{t("Cargando cambios…")}</p>
                      ) : !Object.keys(detail.changes).length ? (
                        <p>
                          {t(
                            "No hay valores de campos disponibles para este evento.",
                          )}
                        </p>
                      ) : (
                        Object.entries(detail.changes).map(([name, change]) => (
                          <div key={name} className="rounded-md border p-3">
                            <h4 className="mb-2 font-medium">
                              {object.config.fields[name]?.label ?? name}
                            </h4>
                            <dl className="grid gap-3 sm:grid-cols-2">
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">
                                  {t("Antes")}
                                </dt>
                                <dd className="whitespace-pre-wrap break-words">
                                  {value(change.before, t)}
                                  {change.beforeTruncated && (
                                    <span className="mt-1 block text-xs text-muted-foreground">
                                      {t(
                                        "Texto truncado (máximo 2048 caracteres)",
                                      )}
                                    </span>
                                  )}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">
                                  {t("Después")}
                                </dt>
                                <dd className="whitespace-pre-wrap break-words">
                                  {value(change.after, t)}
                                  {change.afterTruncated && (
                                    <span className="mt-1 block text-xs text-muted-foreground">
                                      {t(
                                        "Texto truncado (máximo 2048 caracteres)",
                                      )}
                                    </span>
                                  )}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        ))
                      )}
                    </section>
                  )}
                </li>
              ))}
            </ol>
          )}
          <nav
            aria-label={t("Páginas del historial")}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <Button
              variant="outline"
              disabled={cursors.length === 1}
              onClick={() => {
                setPage(undefined);
                setCursors((v) => v.slice(0, -1));
              }}
            >
              {t("Más recientes")}
            </Button>
            <span className="op-muted">
              {t("Página")} {cursors.length}
            </span>
            <Button
              variant="outline"
              disabled={!page.nextCursor}
              onClick={() => {
                setDetail(undefined);
                setSelected(undefined);
                setPage(undefined);
                setCursors((v) => [...v, page.nextCursor]);
              }}
            >
              {t("Anteriores")}
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
