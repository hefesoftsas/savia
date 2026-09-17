import type { ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/api/api-client";

export function TenantHostMismatchError({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  errorInfo?: ErrorInfo;
  resetErrorBoundary?: (args?: any) => void;
}) {
  const isMismatch =
    error instanceof ApiClientError && error.code === "TENANT_HOST_MISMATCH";
  const expectedHost = isMismatch
    ? ((error.details as { expectedHost?: string } | undefined)?.expectedHost)
    : undefined;

  if (isMismatch) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4 rounded-xl border bg-card p-8 shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Espacio de trabajo incorrecto
          </h1>
          <p className="text-sm text-muted-foreground">
            {error.message ||
              "Estás en el espacio de otro tenant. Abre tu URL dedicada para continuar."}
          </p>
          {expectedHost && (
            <div className="pt-2">
              <a
                href={`https://${expectedHost}/#/my-day`}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Ir a mi espacio ({expectedHost})
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-4 rounded-xl border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Ha ocurrido un error inesperado
        </h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        {resetErrorBoundary && (
          <Button onClick={resetErrorBoundary}>Reintentar</Button>
        )}
      </div>
    </div>
  );
}
