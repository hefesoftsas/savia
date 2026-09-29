import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { useAppLocale } from "@/i18n/core";
import { localizedExtensionObjectLabel } from "@/features/studio-engine/extension-screens";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppServices } from "@/features/assistant/assistant-context";
import {
  STUDIO_TENANTS_CHANGED,
  listStudioTenants,
  selectStudioTenant,
  type StudioTenant,
} from "./studio-tenants";
import {
  studioSidebarChildren,
  isStudioNavigationMessage,
  parseStudioSearch,
  summarizeStudioObject,
  type StudioNavigationObject,
  type StudioSidebarChild,
} from "./studio-navigation";

export function useStudioSidebarNavigation(enabled: boolean): {
  tenantId?: number;
  children: StudioSidebarChild[];
} {
  const services = useAppServices();
  const locale = useAppLocale();
  const location = useLocation();
  const current = parseStudioSearch(location.search);
  const [tenants, setTenants] = useState<StudioTenant[]>([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    tenantId: number;
    objects: StudioNavigationObject[];
  }>();
  useEffect(() => {
    const refresh = () => setCatalogVersion((value) => value + 1);
    window.addEventListener(STUDIO_TENANTS_CHANGED, refresh);
    return () => window.removeEventListener(STUDIO_TENANTS_CHANGED, refresh);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void listStudioTenants(services).then(
      (result) => {
        if (active) setTenants(result);
      },
      () => {
        if (active) setTenants([]);
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, services, catalogVersion]);
  const tenant = selectStudioTenant(tenants, current.tenantId);
  const [remoteRevision, setRemoteRevision] = useState(0);
  useRealtimeRefresh({
    topics: ["studio", "records"],
    tenantId: tenant?.tenantId,
    enabled: enabled && !!tenant,
    refresh: () => setRemoteRevision((value) => value + 1),
  });
  useRealtimeRefresh({
    topics: ["account"],
    enabled,
    refresh: () => setCatalogVersion((value) => value + 1),
  });
  useEffect(() => {
    if (!enabled || !tenant) return;
    let active = true;
    const load = () =>
      services.apiClient.get<{ data: unknown[] }>(
        `${tenant.apiBasePath}/api/objects`,
      );
    void (
      services.localData && remoteRevision === 0
        ? services.localData.cachedMetadata(
            `navigation:${tenant.apiBasePath}`,
            load,
          )
        : load()
    )
      .then((response) => {
        if (active)
          setSnapshot({
            tenantId: tenant.tenantId,
            objects: response.data
              .map((row) =>
                summarizeStudioObject(
                  (row ?? {}) as Parameters<typeof summarizeStudioObject>[0],
                ),
              )
              .filter((row): row is StudioNavigationObject => Boolean(row)),
          });
      })
      .catch(() => {
        if (active) setSnapshot({ tenantId: tenant.tenantId, objects: [] });
      });
    return () => {
      active = false;
    };
  }, [
    tenant?.tenantId,
    tenant?.apiBasePath,
    enabled,
    services,
    remoteRevision,
  ]);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        !isStudioNavigationMessage(event.data)
      )
        return;
      if (
        !tenant ||
        (event.data as { tenantId?: number }).tenantId !== tenant.tenantId
      )
        return;
      setSnapshot({
        tenantId: tenant.tenantId,
        objects: event.data.objects
          .map((row) => summarizeStudioObject(row))
          .filter((row): row is StudioNavigationObject => Boolean(row)),
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [tenant?.tenantId]);
  const children = useMemo(() => {
    if (!enabled) return [];
    const objects =
      snapshot?.tenantId === tenant?.tenantId ? (snapshot?.objects ?? []) : [];
    return studioSidebarChildren(
      objects.map((object) => ({
        ...object,
        label: localizedExtensionObjectLabel(object.name, object.label, locale),
      })),
      tenant?.tenantId,
      current.object,
    ).map((item) =>
      item.id === "studio:admin"
        ? {
            ...item,
            label:
              locale === "en"
                ? "Manage"
                : locale === "pt"
                  ? "Administrar"
                  : "Administrar",
          }
        : item,
    );
  }, [enabled, snapshot, tenant?.tenantId, tenants, current.object, locale]);
  return { tenantId: tenant?.tenantId, children };
}
