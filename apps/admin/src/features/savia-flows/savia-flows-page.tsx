import { useCanAccess } from "ra-core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AppServices } from "@/app-services";
import { RouteLoading } from "@/components/admin/route-loading";
import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import {
  listStudioTenants,
  selectStudioTenant,
  type StudioTenant,
} from "@/features/studio/studio-tenants";
import {
  createSaviaFlowsHostBridge,
  saviaFlowsGateState,
  type FlowsTheme,
} from "./bridge";

const forwardedTokens = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
];

export function readSaviaFlowsTheme(): FlowsTheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return {
    mode: root.classList.contains("dark") ? "dark" : "light",
    colorTheme: root.dataset.colorTheme ?? "emerald",
    variables: Object.fromEntries(
      forwardedTokens
        .map((token) => [token, style.getPropertyValue(token).trim()])
        .filter(([, value]) => value),
    ),
  };
}

export const saviaFlowsFrameKey = (tenantId: number) => `tenant-${tenantId}`;

export function SaviaFlowsPage({ services }: { services: AppServices }) {
  const t = useMessages(automationMessages);
  const { canAccess, isPending } = useCanAccess({
    resource: "savia-flows",
    action: "list",
  });
  const [params, setParams] = useSearchParams();
  const [tenants, setTenants] = useState<StudioTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<
    ReturnType<typeof createSaviaFlowsHostBridge> | undefined
  >(undefined);

  useEffect(() => {
    if (!canAccess) return;
    let active = true;
    void listStudioTenants(services)
      .then((items) => {
        if (active) {
          setTenants(items);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : t("Could not load tenants."),
          );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [canAccess, services, t]);

  const requested = params.get("tenantId");
  const selectedId =
    requested && /^\d+$/.test(requested) ? Number(requested) : undefined;
  const selected =
    selectStudioTenant(tenants, selectedId) ??
    (tenants.length === 1 ? tenants[0] : undefined);
  useEffect(() => {
    if (!selected || params.get("tenantId") === String(selected.tenantId))
      return;
    const next = new URLSearchParams(params);
    next.set("tenantId", String(selected.tenantId));
    setParams(next, { replace: true });
  }, [selected, params, setParams]);

  useEffect(() => {
    if (!selected) return;
    const update = () => bridge.current?.setTheme(readSaviaFlowsTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-color-theme"],
    });
    update();
    return () => observer.disconnect();
  }, [selected?.tenantId]);

  const tenantLabel = selected?.label ?? "";
  useLayoutEffect(
    () => () => {
      bridge.current?.dispose();
      bridge.current = undefined;
    },
    [selected?.tenantId],
  );
  const gate = saviaFlowsGateState({
    isPending,
    canAccess: Boolean(canAccess),
    loading,
  });
  if (gate === "loading")
    return <RouteLoading variant="screens" label={t("Loading Savia Flows…")} />;
  if (gate === "denied")
    return (
      <p className="p-6" role="alert">
        {t("Savia Flows is available to active tenant members.")}
      </p>
    );
  if (error)
    return (
      <p className="p-6" role="alert">
        {t("Could not load tenants.")} {error}
      </p>
    );
  if (!tenants.length)
    return (
      <p className="p-6" role="status">
        {t("Choose an active tenant to use Savia Flows.")}
      </p>
    );

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Savia Flows</h1>
          <p className="text-xs text-muted-foreground">{tenantLabel}</p>
        </div>
        {tenants.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span>{t("Tenant")}</span>
            <select
              aria-label={t("Tenant")}
              className="h-9 rounded-md border bg-background px-2"
              value={selected ? String(selected.tenantId) : ""}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                next.set("tenantId", event.target.value);
                setParams(next);
              }}
            >
              <option value="" disabled>
                {t("Select a tenant")}
              </option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.tenantId}>
                  {tenant.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      {selected ? (
        <iframe
          key={saviaFlowsFrameKey(selected.tenantId)}
          ref={frame}
          title={t("Savia Flows editor")}
          src="/flows-ui/"
          className="min-h-0 w-full flex-1 border-0 bg-background"
          onLoad={() => {
            bridge.current?.dispose();
            if (!frame.current) return;
            const next = createSaviaFlowsHostBridge({
              frame: frame.current,
              api: services.apiClient,
              tenantId: selected.tenantId,
              origin: window.location.origin,
              theme: readSaviaFlowsTheme(),
            });
            bridge.current = next;
            next.start();
          }}
        />
      ) : (
        <div className="grid min-h-96 flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">
          {t("Select a tenant to open its Savia Flows workspace.")}
        </div>
      )}
    </main>
  );
}
