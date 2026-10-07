import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { api } from "./api";
import type { WorkflowDefinition } from "@savia/studio-shared/workflows";

type Flow = {
  id: string;
  name: string;
  enabled: number;
  definition: WorkflowDefinition;
};

export default function RecordWorkflowAction({
  collection,
  recordId,
}: {
  collection: string;
  recordId: string;
}) {
  const t = useMessages(automationMessages);
  const [flowId, setFlowId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const list = useQuery({
    queryKey: ["record-manual-workflows"],
    queryFn: () => api<{ data: Flow[] }>("/workflows"),
    staleTime: 30_000,
  });
  const manual = (list.data?.data ?? []).filter(
    (flow) => flow.definition?.trigger?.type === "manual" && flow.enabled,
  );
  if (!list.data && list.isPending) return null;
  if (manual.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("Flujo manual para este registro")}
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={flowId}
        onChange={(e) => {
          setFlowId(e.target.value);
          setError("");
          setNotice("");
        }}
      >
        <option value="">{t("Ejecutar flujo…")}</option>
        {manual.map((flow) => (
          <option key={flow.id} value={flow.id}>
            {flow.name}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !flowId}
        onClick={async () => {
          if (!flowId) return;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            await api(`/workflows/${flowId}/start`, "POST", {
              data: { collection, record_id: recordId },
              key: crypto.randomUUID(),
            });
            setNotice(
              t("Ejecución enviada. Consulta su estado en el historial."),
            );
          } catch (e) {
            setError(
              e instanceof Error ? e.message : t("No se pudo ejecutar."),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Play size={15} /> {busy ? t("Enviando…") : t("Ejecutar")}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
      {notice && (
        <span role="status" className="text-sm text-muted-foreground">
          {notice}
        </span>
      )}
    </span>
  );
}
