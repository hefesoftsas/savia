/*
 * Direction contract — Secrets screen (Operate, incumbent admin world).
 * THESIS: secret migration belongs to no single flow; one screen moves every
 * flow at once, and nothing applies before the admin reviews the preview.
 * OWN-WORLD: established admin chrome (max-w-6xl canvas, shadcn Card/Button,
 * muted descriptions, status/alert message roles, KeyRound motif). No new
 * visual language, no hero metrics, no decorative motion.
 * STORY: the admin opens Secretos in the sidebar, exports one JSON for the
 * whole environment, imports it in the other one, and reviews per-flow
 * results. Empty file values never overwrite saved values.
 * FIRST VIEWPORT: header with task description, then two task cards side by
 * side (Exportar / Importar); import grows into preview and results below.
 * FORM: bulk-only transfer; per-flow editing stays in the flow workspace.
 */
import { useRef, useState, type ReactNode } from "react";
import { Download, Info, KeyRound, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSaviaRequestWorkspace } from "./savia-request-provider";
import {
  buildSecretsFile,
  downloadJsonFile,
  parseSecretsFile,
  transferFileName,
  type SecretsFile,
} from "./secrets-transfer";

type Message = { kind: "status" | "alert"; text: string } | null;

type PreviewEntry = {
  flowId: string;
  name: string;
  known: boolean;
  withValue: number;
  empty: number;
};

type ImportResult = {
  flowId: string;
  name: string;
  applied: number;
  skipped: number;
  status: "updated" | "unchanged" | "unknown" | "error";
  error?: string;
};

function SecretHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={label}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export function SecretsScreen() {
  const { api, busy: parentBusy, dirty } = useSaviaRequestWorkspace();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [preview, setPreview] = useState<SecretsFile | null>(null);
  const [previewEntries, setPreviewEntries] = useState<PreviewEntry[]>([]);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const disabled = parentBusy || busy || dirty;

  const exportAll = async () => {
    setBusy(true);
    setMessage(null);
    setResults(null);
    setProgress("Exportando secretos…");
    try {
      const exported = await api.exportSecrets();
      if (!exported.flows.length)
        throw new Error("No hay variables para exportar.");
      const withValue = exported.flows.reduce(
        (total, entry) =>
          total + entry.variables.filter((variable) => variable.value).length,
        0,
      );
      downloadJsonFile(
        transferFileName("todos", exported.exportedAt),
        buildSecretsFile(exported.flows, exported.exportedAt),
      );
      setMessage({
        kind: "status",
        text: `Secretos de ${exported.flows.length} flow(s) exportados (${withValue} con valor). Guárdalos en un lugar seguro.`,
      });
    } catch (exception) {
      setMessage({
        kind: "alert",
        text:
          exception instanceof Error
            ? exception.message
            : "No pudimos exportar los secretos.",
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const previewFile = async (file: File) => {
    setBusy(true);
    setMessage(null);
    setResults(null);
    try {
      const parsed = parseSecretsFile(await file.text());
      const summaries = await api.listFlows();
      const names = new Map(summaries.map((flow) => [flow.id, flow.name]));
      setPreviewEntries(
        parsed.flows.map((entry) => ({
          flowId: entry.flowId,
          name: names.get(entry.flowId) ?? entry.flowId,
          known: names.has(entry.flowId),
          withValue: entry.variables.filter((variable) => variable.value)
            .length,
          empty: entry.variables.filter((variable) => !variable.value).length,
        })),
      );
      setPreview(parsed);
    } catch (exception) {
      setPreview(null);
      setPreviewEntries([]);
      setMessage({
        kind: "alert",
        text:
          exception instanceof Error
            ? exception.message
            : "No pudimos leer el archivo.",
      });
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    setResults(null);
    setProgress("Aplicando importación…");
    try {
      const names = new Map(
        previewEntries.map((entry) => [entry.flowId, entry.name]),
      );
      const { results: imported } = await api.importSecrets(preview);
      const outcomes: ImportResult[] = imported.map((result) => ({
        flowId: result.flowId,
        name: names.get(result.flowId) ?? result.flowId,
        applied: result.applied,
        skipped: result.skipped,
        status: result.status,
      }));
      setResults(outcomes);
      const applied = outcomes.reduce((total, item) => total + item.applied, 0);
      const errors = outcomes.filter((item) => item.status === "error").length;
      if (!applied && !errors)
        throw new Error("El archivo no trae valores para importar.");
      setMessage({
        kind: errors ? "alert" : "status",
        text:
          `Importación completa: ${applied} valor(es) en ` +
          `${outcomes.filter((item) => item.status === "updated").length} flow(s)` +
          (errors ? ` · ${errors} flow(s) con error` : "") +
          ".",
      });
      setPreview(null);
      setPreviewEntries([]);
    } catch (exception) {
      setMessage({
        kind: "alert",
        text:
          exception instanceof Error
            ? exception.message
            : "No pudimos importar los secretos.",
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl pb-10">
      <header className="py-6">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <KeyRound className="size-4" aria-hidden="true" />
          Administración
        </div>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Secretos</h1>
          <SecretHelp label="Ayuda sobre la transferencia de secretos">
            Mueve los secretos de todos los flows entre ambientes con un único
            archivo. Exporta en el ambiente origen e impórtalo en el destino.
          </SecretHelp>
        </div>
      </header>

      {dirty ? (
        <p
          className="mb-5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          Tienes cambios sin guardar en un flow. Guárdalos antes de exportar o
          importar para trabajar sobre lo guardado.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle>Exportar todo</CardTitle>
              <SecretHelp label="Ayuda para exportar secretos">
                Descarga un archivo JSON con las variables de todos los flows,
                incluyendo los valores de los secretos.
              </SecretHelp>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              disabled={disabled}
              onClick={() => void exportAll()}
              type="button"
            >
              <Download />
              {progress ?? "Exportar todos los secretos"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle>Importar todo</CardTitle>
              <SecretHelp label="Ayuda para importar secretos">
                Sube el archivo exportado en el otro ambiente. Revisa el resumen
                y aplica la importación a todos los flows a la vez.
              </SecretHelp>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
                type="button"
                variant="outline"
              >
                <Upload /> Seleccionar archivo
              </Button>
              {preview ? (
                <>
                  <Button
                    disabled={disabled}
                    onClick={() => void applyImport()}
                    type="button"
                  >
                    {progress ?? "Aplicar importación"}
                  </Button>
                  <Button
                    disabled={disabled}
                    onClick={() => {
                      setPreview(null);
                      setPreviewEntries([]);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    Descartar
                  </Button>
                </>
              ) : null}
            </div>
            <input
              accept=".json,application/json"
              aria-label="Archivo de secretos"
              className="hidden"
              disabled={disabled}
              onChange={(event) => {
                const [file] = event.target.files ?? [];
                event.target.value = "";
                if (file) void previewFile(file);
              }}
              ref={fileInput}
              type="file"
            />
          </CardContent>
        </Card>
      </div>

      <div
        className="mt-5 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
        role="note"
      >
        <span>Seguridad del archivo</span>
        <SecretHelp label="Ayuda sobre la seguridad del archivo">
          Los archivos contienen secretos en texto plano. Guárdalos en un lugar
          seguro, elimínalos después de importarlos y nunca los subas a Git. Los
          valores vacíos nunca sobrescriben lo ya guardado en el destino.
        </SecretHelp>
      </div>

      {message ? (
        <p
          className={
            message.kind === "status"
              ? "mt-4 rounded-md bg-primary/8 px-3 py-2 text-sm text-primary"
              : "mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
          role={message.kind}
        >
          {message.text}
        </p>
      ) : null}

      {preview ? (
        <section
          aria-label="Resumen del archivo"
          className="mt-5 rounded-lg border p-4"
        >
          <h2 className="text-base font-semibold">Revisa antes de aplicar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {preview.flows.length} flow(s) en el archivo. Nada se ha guardado
            todavía.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-150 text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Flow</th>
                  <th className="pb-2 pr-3 font-medium">Con valor</th>
                  <th className="pb-2 pr-3 font-medium">Vacíos</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {previewEntries.map((entry) => (
                  <tr className="border-b last:border-0" key={entry.flowId}>
                    <td className="py-2 pr-3 font-medium">{entry.name}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {entry.withValue}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{entry.empty}</td>
                    <td className="py-2">
                      {entry.known ? "Listo" : "Desconocido · se omitirá"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {results ? (
        <section
          aria-label="Resultado de la importación"
          className="mt-5 rounded-lg border p-4"
        >
          <h2 className="text-base font-semibold">Resultado</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-150 text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Flow</th>
                  <th className="pb-2 pr-3 font-medium">Aplicados</th>
                  <th className="pb-2 pr-3 font-medium">Omitidos</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr className="border-b last:border-0" key={result.flowId}>
                    <td className="py-2 pr-3 font-medium">{result.name}</td>
                    <td className="py-2 pr-3 tabular-nums">{result.applied}</td>
                    <td className="py-2 pr-3 tabular-nums">{result.skipped}</td>
                    <td className="py-2">
                      {result.status === "updated"
                        ? "Actualizado"
                        : result.status === "unchanged"
                          ? "Sin cambios"
                          : result.status === "unknown"
                            ? "Omitido · no existe aquí"
                            : (result.error ?? "Error")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
