import { useCallback, useEffect, useState } from "react";
import { CloudOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCanAccess, useTranslate } from "ra-core";
import { toast } from "sonner";
import type { AppServices } from "@/app-services";
import type { TenantRecord } from "@/api/tenant-data-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { isOfflineError } from "@/offline/offline-error";
import type { CollectionOfflinePolicy } from "@/offline/offline-policy";

type TenantListResponse = {
  data: TenantRecord[];
};

const COLLECTION_PATTERN = /^[a-z][a-z0-9_]*$/;
const MIN_REFRESH_SECONDS = 30;
const MAX_REFRESH_SECONDS = 86400;

function errorMessage(error: unknown): string {
  if (isOfflineError(error)) {
    return "Sin conexión. Inténtalo de nuevo.";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 403
  ) {
    return "No tienes permiso para administrar este tenant.";
  }
  return error instanceof Error ? error.message : "No se pudo guardar.";
}

/**
 * Per-tenant offline policy administration: which collections persist
 * offline and how often visible lists refetch. Platform admins pick any
 * tenant; tenant admins only see their own (the tenants endpoint scopes).
 */
export function OfflinePoliciesPage({ services }: { services: AppServices }) {
  const translate = useTranslate();
  const { canAccess, isPending } = useCanAccess({
    resource: "offline-policies",
    action: "edit",
  });
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [tenantId, setTenantId] = useState<string>("");
  const [policies, setPolicies] = useState<CollectionOfflinePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [collection, setCollection] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [refreshSeconds, setRefreshSeconds] = useState("300");

  const loadPolicies = useCallback(
    async (id: number) => {
      setLoading(true);
      try {
        const response = await services.apiClient.get<{
          data: CollectionOfflinePolicy[];
        }>(`/v1/offline/collections?tenantId=${id}`);
        setPolicies(response.data);
      } catch (error) {
        toast.error(errorMessage(error));
        setPolicies([]);
      } finally {
        setLoading(false);
      }
    },
    [services],
  );

  useEffect(() => {
    let active = true;
    services.apiClient
      .get<TenantListResponse>("/v1/tenants")
      .then((response) => {
        if (!active) return;
        const commercial = response.data.filter(
          (tenant) => tenant.kind === "commercial",
        );
        setTenants(commercial);
        if (commercial[0]) {
          setTenantId(String(commercial[0].id));
          void loadPolicies(commercial[0].id);
        } else {
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error(errorMessage(error));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [services, loadPolicies]);

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-6xl pb-12" aria-label="Cargando">
        <p className="py-6 text-sm text-muted-foreground">Cargando…</p>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main className="mx-auto w-full max-w-6xl pb-12">
        <p className="py-6 text-sm text-muted-foreground">
          No tienes permiso para administrar el modo sin conexión.
        </p>
      </main>
    );
  }

  const save = async () => {
    const name = collection.trim().toLowerCase();
    const seconds = Number(refreshSeconds);
    if (!COLLECTION_PATTERN.test(name)) {
      toast.error(
        "Nombre inválido: minúsculas, números y guion bajo, empezando por letra.",
      );
      return;
    }
    if (
      !Number.isInteger(seconds) ||
      seconds < MIN_REFRESH_SECONDS ||
      seconds > MAX_REFRESH_SECONDS
    ) {
      toast.error(
        `El intervalo debe estar entre ${MIN_REFRESH_SECONDS} y ${MAX_REFRESH_SECONDS} segundos.`,
      );
      return;
    }
    if (!tenantId) return;
    setSaving(true);
    try {
      await services.apiClient.put("/v1/offline/collections", {
        tenantId: Number(tenantId),
        collection: name,
        enabled,
        refreshSeconds: seconds,
      });
      toast.success("Política guardada.");
      setCollection("");
      await loadPolicies(Number(tenantId));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    if (!tenantId) return;
    try {
      await services.apiClient.delete(
        `/v1/offline/collections?tenantId=${tenantId}&collection=${encodeURIComponent(name)}`,
      );
      toast.success("Política eliminada (offline desactivado).");
      await loadPolicies(Number(tenantId));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl pb-12">
      <header className="py-6">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <CloudOff className="size-4" aria-hidden="true" />{" "}
          {translate("savia.offline.category", { _: "Gestión" })}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {translate("savia.offline.title", { _: "Sin conexión por colección" })}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {translate("savia.offline.description", {
            _,
          })}
        </p>
      </header>

      <section
        aria-label="Tenant"
        className="mb-4 flex max-w-md flex-col gap-2"
      >
        <Label htmlFor="offline-tenant">Tenant</Label>
        <Select
          value={tenantId}
          onValueChange={(value) => {
            setTenantId(value);
            void loadPolicies(Number(value));
          }}
        >
          <SelectTrigger id="offline-tenant">
            <SelectValue placeholder="Selecciona un tenant" />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((tenant) => (
              <SelectItem key={tenant.id} value={String(tenant.id)}>
                {tenant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section
        aria-label="Agregar colección"
        className="mb-6 grid max-w-3xl gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      >
        <div className="grid gap-2">
          <Label htmlFor="offline-collection">Colección</Label>
          <Input
            id="offline-collection"
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
            placeholder="cotizaciones"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="offline-refresh">Refresco (s)</Label>
          <Input
            id="offline-refresh"
            inputMode="numeric"
            value={refreshSeconds}
            onChange={(event) => setRefreshSeconds(event.target.value)}
            className="w-28"
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          Offline
        </label>
        <Button type="button" disabled={saving || !tenantId} onClick={() => void save()}>
          <Plus className="size-4" aria-hidden />
          Guardar
        </Button>
      </section>

      <section aria-label="Políticas" className="max-w-3xl">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin colecciones offline en este tenant. Solo metadatos y
            administración usan caché.
          </p>
        ) : (
          <ul className="space-y-2">
            {policies.map((policy) => (
              <li
                key={policy.collection}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="text-sm">
                  <span className="font-medium">{policy.collection}</span>
                  <span className="ml-2 text-muted-foreground">
                    {policy.enabled
                      ? `cada ${policy.refreshSeconds} s`
                      : "desactivado"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Alternar ${policy.collection}`}
                    onClick={() =>
                      void (async () => {
                        try {
                          await services.apiClient.put(
                            "/v1/offline/collections",
                            {
                              tenantId: Number(tenantId),
                              collection: policy.collection,
                              enabled: !policy.enabled,
                              refreshSeconds: policy.refreshSeconds,
                            },
                          );
                          await loadPolicies(Number(tenantId));
                        } catch (error) {
                          toast.error(errorMessage(error));
                        }
                      })()
                    }
                  >
                    <RotateCcw className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Eliminar ${policy.collection}`}
                    onClick={() => void remove(policy.collection)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

const _ =
  "Elige qué colecciones siguen disponibles sin conexión y cada cuánto se refrescan sus listas. Solo listas agregadas: nunca detalles, archivos ni credenciales.";
