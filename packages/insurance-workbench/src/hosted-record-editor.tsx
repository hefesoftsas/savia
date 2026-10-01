import { useEffect, useMemo, useState } from "react";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { RecordEditor } from "./editor";
import { errorMessage, type WorkRecord } from "./data";
import { useWorkbenchMessages } from "./localization";
import type { WorkbenchConfig } from "./types";

export function HostedRecordEditor({
  savia,
  config,
}: {
  savia: PluginApi;
  config: WorkbenchConfig;
}) {
  const context = savia.ui!.panel!;
  const recordId = context.request.params.recordId;
  const [record, setRecord] = useState<WorkRecord | null>(null);
  const [loading, setLoading] = useState(!!recordId);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [operations, setOperations] = useState(0);
  const t = useWorkbenchMessages(config.messages);
  // Track custom record actions and attachments as well as the main form save.
  const api = useMemo(() => {
    const track = async <T,>(action: () => Promise<T>): Promise<T> => {
      setOperations((n) => n + 1);
      try {
        return await action();
      } finally {
        setOperations((n) => n - 1);
      }
    };
    return {
      ...savia,
      collections: {
        ...savia.collections,
        collection: (
          ...args: Parameters<PluginApi["collections"]["collection"]>
        ) => {
          const collection = savia.collections.collection(...args);
          return {
            ...collection,
            get: (...a: Parameters<typeof collection.get>) =>
              track(() => collection.get(...a)),
            create: (...a: Parameters<typeof collection.create>) =>
              track(() => collection.create(...a)),
            update: (...a: Parameters<typeof collection.update>) =>
              track(() => collection.update(...a)),
            remove: (...a: Parameters<typeof collection.remove>) =>
              track(() => collection.remove(...a)),
          };
        },
      },
      files: savia.files && {
        ...savia.files,
        upload: (...a: Parameters<NonNullable<PluginApi["files"]>["upload"]>) =>
          track(() => savia.files!.upload(...a)),
        remove: (...a: Parameters<NonNullable<PluginApi["files"]>["remove"]>) =>
          track(() => savia.files!.remove(...a)),
      },
    } as PluginApi;
  }, [savia]);
  useEffect(() => {
    if (!recordId) return;
    let active = true;
    setLoading(true);
    setError("");
    savia.collections
      .collection<WorkRecord>(config.object)
      .get(recordId)
      .then((value) => {
        if (active) setRecord(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [savia, config.object, recordId, revision]);
  useEffect(() => {
    if (loading || error)
      savia.ui!.setPanelState({ dirty: false, busy: loading });
  }, [savia, loading, error]);
  return (
    <section
      className="iw-workbench iw-hosted-workbench"
      aria-label={config.singular}
    >
      {loading ? (
        <p role="status">{t("Cargando vínculos…")}</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setRevision((n) => n + 1)}>
            {t("Reintentar")}
          </button>
        </div>
      ) : (
        <RecordEditor
          config={config}
          record={record}
          savia={api}
          embedded
          operationBusy={operations > 0}
          onClose={() => savia.ui!.requestClose()}
          onSaved={() => savia.ui!.completePanel({ status: "saved" })}
        />
      )}
    </section>
  );
}
