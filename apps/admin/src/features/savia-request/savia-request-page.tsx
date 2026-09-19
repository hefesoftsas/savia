import { Workflow, LockKeyhole } from "lucide-react";
import { lazy, Suspense } from "react";
import { useCanAccess } from "ra-core";
import type { AppServices } from "@/app-services";
import { RouteLoading } from "@/components/admin/route-loading";

const SaviaRequestDocs = lazy(async () => {
  const module = await import("./savia-request-docs");
  return { default: module.SaviaRequestDocs };
});
const SaviaRequestWorkspace = lazy(async () => {
  const module = await import("./savia-request-workspace");
  return { default: module.SaviaRequestWorkspace };
});

export function SaviaRequestPage({
  services: _services,
  docs = false,
}: {
  services: AppServices;
  docs?: boolean;
}) {
  const { canAccess, isPending } = useCanAccess({
    resource: "savia-request",
    action: "list",
  });
  if (isPending) return <RouteLoading label="Cargando Savia Request…" />;
  if (!canAccess)
    return (
      <section className="space-y-6">
        <header>
          <Workflow className="mb-3 size-6 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">
            Savia Request
          </h1>
          <p className="mt-2 text-muted-foreground">
            Diseña solicitudes, organiza flujos y revisa sus ejecuciones.
          </p>
        </header>
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border p-5"
        >
          <LockKeyhole className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="font-semibold">
              Acceso de administrador de plataforma
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu cuenta no tiene acceso al editor de flujos. Entra con una
              cuenta de administrador de plataforma para utilizar Savia Request.
            </p>
          </div>
        </div>
      </section>
    );
  return (
    <Suspense fallback={<RouteLoading label="Cargando Savia Request…" />}>
      {docs ? <SaviaRequestDocs /> : <SaviaRequestWorkspace />}
    </Suspense>
  );
}
