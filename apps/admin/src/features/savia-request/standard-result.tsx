import { useEffect, useState, type ReactNode } from "react";
import type { RequestResult } from "../../../../api/src/request-results/contracts";
import { releaseCatalog } from "@savia/release-catalog";

const statusLabels = {
  success: "Resultado disponible",
  partial: "Resultado parcial",
  no_result: "Sin resultados",
  error: "No se completó la operación",
  pending: "En proceso",
};

export function StandardResult({
  extensionId,
  flowId,
  runId,
  read,
  renderer,
}: {
  extensionId?: string;
  flowId: string;
  runId: string;
  read(flowId: string, runId: string): Promise<RequestResult>;
  renderer?: (result: RequestResult) => ReactNode;
}) {
  const [result, setResult] = useState<RequestResult | null>(null);
  const [error, setError] = useState("");
  const catalogRenderer = extensionId
    ? releaseCatalog.extensionResultRenderers.find(
        (item) => item.extensionId === extensionId,
      )
    : undefined;

  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    void read(flowId, runId).then(
      (value) => {
        if (active) setResult(value);
      },
      () => {
        if (active) {
          setError(
            "No se pudo cargar el resultado estándar. La respuesta original sigue disponible.",
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [flowId, read, runId]);

  return (
    <section
      aria-label="Resultado estándar"
      className="space-y-3"
      data-extension-id={extensionId}
    >
      <div className="border-b pb-3">
        <h3 className="text-sm font-semibold">Resultado estándar</h3>
        {error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {!result && !error ? (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            Preparando resultado…
          </p>
        ) : null}
        {result ? (
          <p
            className="mt-2 text-sm text-emerald-700 dark:text-emerald-300"
            role="status"
          >
            {statusLabels[result.status]}
            {result.metadata.simulated ? " · Simulación" : ""}
          </p>
        ) : null}
      </div>
      {result?.errors.map((item, index) => (
        <p
          className="text-sm text-destructive"
          key={`${item.code}-${index}`}
          role="alert"
        >
          {item.message}
        </p>
      ))}
      {result?.warnings.map((item, index) => (
        <p
          className="text-sm text-amber-700 dark:text-amber-300"
          key={`${item.code}-${index}`}
        >
          {item.message}
        </p>
      ))}
      {result && renderer ? renderer(result) : null}
      {result && !renderer && catalogRenderer ? (
        <catalogRenderer.Renderer result={result} />
      ) : null}
      {result ? (
        <details className="rounded-md border bg-muted/20 p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Ver JSON estándar y metadata
          </summary>
          <pre
            className="mt-3 max-h-72 overflow-auto rounded bg-background p-3 text-xs"
            tabIndex={0}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
