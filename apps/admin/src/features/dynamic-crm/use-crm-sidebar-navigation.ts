import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppServices } from "@/features/assistant/assistant-context";
import {
  CRM_DOMAINS_CHANGED,
  listCrmDomains,
  selectCrmDomain,
  type CrmDomain,
} from "./crm-domains";
import {
  crmSidebarChildren,
  isCrmNavigationMessage,
  parseCrmSearch,
  summarizeCrmObject,
  type CrmNavigationObject,
  type CrmSidebarChild,
} from "./crm-navigation";

export function useCrmSidebarNavigation(enabled: boolean): {
  agencyId?: number;
  domainId?: string;
  children: CrmSidebarChild[];
} {
  const services = useAppServices();
  const location = useLocation();
  const current = parseCrmSearch(location.search);
  const [domains, setDomains] = useState<CrmDomain[]>([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    domainId: string;
    objects: CrmNavigationObject[];
  }>();
  useEffect(() => {
    const refresh = () => setCatalogVersion((value) => value + 1);
    window.addEventListener(CRM_DOMAINS_CHANGED, refresh);
    return () => window.removeEventListener(CRM_DOMAINS_CHANGED, refresh);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void listCrmDomains(services).then(
      (result) => {
        if (active) setDomains(result);
      },
      () => {
        if (active) setDomains([]);
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, services, catalogVersion]);
  const domain = selectCrmDomain(domains, current.domain, current.agencyId);
  useEffect(() => {
    if (!enabled || !domain) return;
    let active = true;
    const load = () =>
      services.apiClient.get<{ data: unknown[] }>(
        `${domain.apiBasePath}/api/objects`,
      );
    void (
      services.localData
        ? services.localData.cachedMetadata(
            `navigation:${domain.apiBasePath}`,
            load,
          )
        : load()
    )
      .then((response) => {
        if (active)
          setSnapshot({
            domainId: domain.id,
            objects: response.data
              .map((row) =>
                summarizeCrmObject(
                  (row ?? {}) as Parameters<typeof summarizeCrmObject>[0],
                ),
              )
              .filter((row): row is CrmNavigationObject => Boolean(row)),
          });
      })
      .catch(() => {
        if (active) setSnapshot({ domainId: domain.id, objects: [] });
      });
    return () => {
      active = false;
    };
  }, [domain?.id, domain?.apiBasePath, enabled, services]);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        !isCrmNavigationMessage(event.data)
      )
        return;
      if (
        !domain ||
        (event.data as { domainId?: string }).domainId !== domain.id
      )
        return;
      setSnapshot({
        domainId: domain.id,
        objects: event.data.objects
          .map((row) => summarizeCrmObject(row))
          .filter((row): row is CrmNavigationObject => Boolean(row)),
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [domain?.id]);
  const children = useMemo(() => {
    if (!enabled) return [];
    const objects =
      snapshot?.domainId === domain?.id ? (snapshot?.objects ?? []) : [];
    return crmSidebarChildren(objects, domain?.id, current.object);
  }, [enabled, snapshot, domain?.id, domains, current.object]);
  return { agencyId: domain?.agencyId, domainId: domain?.id, children };
}
