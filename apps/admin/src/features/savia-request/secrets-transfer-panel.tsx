import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SaviaRequestApi } from "./savia-request-api";
import {
  buildSecretsFile,
  downloadJsonFile,
  mergeVariables,
  parseSecretsFile,
  pickFlowEntry,
  transferFileName,
  type TransferFlow,
} from "./secrets-transfer";
import type { RequestFlow, RequestVariable } from "./types";

type Message = { kind: "status" | "alert"; text: string } | null;

async function resolveVariables(
  api: SaviaRequestApi,
  flowId: string,
  variables: RequestVariable[],
): Promise<TransferFlow> {
  const resolved = [];
  for (const variable of variables) {
    if (variable.secret && !variable.value && variable.configured) {
      const revealed = await api.revealVariable(flowId, variable.key);
      resolved.push({
        key: variable.key,
        value: revealed.value,
        secret: variable.secret,
      });
    } else {
      resolved.push({
        key: variable.key,
        value: variable.value,
        secret: variable.secret,
      });
    }
  }
  return { flowId, variables: resolved };
}

export function SecretsTransferPanel({
  api,
  flow,
  working,
  onMergeCurrent,
}: {
  api: SaviaRequestApi;
  flow: RequestFlow;
  working: boolean;
  onMergeCurrent(variables: RequestVariable[]): void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [scope, setScope] = useState<"flow" | "all">("flow");
  const fileInput = useRef<HTMLInputElement>(null);
  const disabled = working || busy;

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "status", text: await work() });
    } catch (exception) {
      setMessage({
        kind: "alert",
        text:
          exception instanceof Error
            ? exception.message
            : "No pudimos completar la operación.",
      });
    } finally {
      setBusy(false);
    }
  };

  const exportFlow = () =>
    run(async () => {
      if (!flow.variables.length)
        throw new Error("Este flow no tiene variables para exportar.");
      const entry = await resolveVariables(api, flow.id, flow.variables);
      const withValue = entry.variables.filter(
        (variable) => variable.value,
      ).length;
      downloadJsonFile(transferFileName(flow.id), buildSecretsFile([entry]));
      return `Secretos de «${flow.name}» exportados (${withValue} con valor, ${entry.variables.length - withValue} vacíos). Guárdalos en un lugar seguro.`;
    });

  const exportAll = () =>
    run(async () => {
      setMessage({
        kind: "status",
        text: "Exportando secretos de todos los flows…",
      });
      const summaries = await api.listFlows();
      const entries: TransferFlow[] = [];
      for (const summary of summaries) {
        const variables =
          summary.id === flow.id
            ? flow.variables
            : (await api.readFlow(summary.id)).variables;
        if (!variables.length) continue;
        entries.push(await resolveVariables(api, summary.id, variables));
      }
      if (!entries.length) throw new Error("No hay variables para exportar.");
      const withValue = entries.reduce(
        (total, entry) =>
          total + entry.variables.filter((variable) => variable.value).length,
        0,
      );
      downloadJsonFile(transferFileName("todos"), buildSecretsFile(entries));
      return `Secretos de ${entries.length} flow(s) exportados (${withValue} con valor). Guárdalos en un lugar seguro.`;
    });

  const importFile = async (file: File) => {
    const parsed = parseSecretsFile(await file.text());
    if (scope === "flow") {
      const entry = pickFlowEntry(parsed, flow.id);
      const { merged, applied, skippedEmpty } = mergeVariables(
        flow.variables,
        entry.variables,
      );
      if (!applied)
        throw new Error(
          "El archivo no trae valores para importar (todo vacío).",
        );
      onMergeCurrent(merged);
      return `Importados ${applied} valor(es) en «${flow.name}» (${skippedEmpty} vacíos omitidos). Guarda los cambios para aplicarlos.`;
    }
    const summaries = await api.listFlows();
    const known = new Set(summaries.map((summary) => summary.id));
    let updated = 0;
    let pending = 0;
    let unknown = 0;
    let applied = 0;
    let skippedEmpty = 0;
    for (const entry of parsed.flows) {
      if (entry.flowId === flow.id) {
        const result = mergeVariables(flow.variables, entry.variables);
        if (result.applied) {
          onMergeCurrent(result.merged);
          pending += 1;
        }
        applied += result.applied;
        skippedEmpty += result.skippedEmpty;
        continue;
      }
      if (!known.has(entry.flowId)) {
        unknown += 1;
        continue;
      }
      const current = await api.readFlow(entry.flowId);
      const result = mergeVariables(current.variables, entry.variables);
      if (result.applied) {
        await api.saveVariables(entry.flowId, result.merged);
        updated += 1;
      }
      applied += result.applied;
      skippedEmpty += result.skippedEmpty;
    }
    if (!applied)
      throw new Error("El archivo no trae valores para importar (todo vacío).");
    const parts = [`Importación completa: ${applied} valor(es)`];
    if (updated) parts.push(`${updated} flow(s) guardados`);
    if (pending) parts.push(`«${flow.name}» pendiente de Guardar`);
    if (skippedEmpty) parts.push(`${skippedEmpty} vacíos omitidos`);
    if (unknown) parts.push(`${unknown} flow(s) desconocidos omitidos`);
    return `${parts.join(" · ")}.`;
  };

  return (
    <section
      aria-label="Mover secretos entre ambientes"
      className="rounded-lg border p-4"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold">
            Mover secretos entre ambientes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Exporta este flow o todos los flows a un archivo JSON e impórtalo en
            el otro ambiente. Los valores vacíos nunca sobrescriben lo guardado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={disabled}
            onClick={exportFlow}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download /> Exportar flow
          </Button>
          <Button
            disabled={disabled}
            onClick={() => {
              setScope("flow");
              fileInput.current?.click();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload /> Importar al flow
          </Button>
          <Button
            disabled={disabled}
            onClick={exportAll}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download /> Exportar todos
          </Button>
          <Button
            disabled={disabled}
            onClick={() => {
              setScope("all");
              fileInput.current?.click();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload /> Importar todos
          </Button>
        </div>
      </div>
      <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Los archivos contienen secretos en texto plano. Guárdalos en un lugar
        seguro, elimínalos después de importarlos y nunca los subas a Git.
      </p>
      {message ? (
        <p
          className={
            message.kind === "status"
              ? "mt-3 rounded-md bg-primary/8 px-3 py-2 text-sm text-primary"
              : "mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
          role={message.kind}
        >
          {message.text}
        </p>
      ) : null}
      <input
        accept=".json,application/json"
        aria-label="Archivo de secretos"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const [file] = event.target.files ?? [];
          event.target.value = "";
          if (file) void run(() => importFile(file));
        }}
        ref={fileInput}
        type="file"
      />
    </section>
  );
}
