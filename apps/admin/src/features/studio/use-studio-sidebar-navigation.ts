import { useAppLocale } from "@/i18n/core";
import { localizedExtensionObjectLabel } from "@/features/studio-engine/extension-screens";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppServices } from "@/features/assistant/assistant-context";
import {
  STUDIO_DOMAINS_CHANGED,
  listStudioDomains,
  selectStudioDomain,
  type StudioDomain,
} from "./studio-domains";
import {
  studioSidebarChildren,
  isStudioNavigationMessage,
  parseStudioSearch,
  summarizeStudioObject,
  type StudioNavigationObject,
  type StudioSidebarChild,
} from "./studio-navigation";

export function useCrmSidebarNavigation(enabled: boolean): {
  agencyId?: number;
  domainId?: string;
  children: StudioSidebarChild[];
} {
  const services = useAppServices();
  const locale = useAppLocale();
  const location = useLocation();
  const current = parseStudioSearch(location.search);
  const [domains, setDomains] = useState<StudioDomain[]>([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    domainId: string;
    objects: StudioNavigationObject[];
  }>();
  useEffect(() => {
    const refresh = () => setCatalogVersion((value) => value + 1);
    window.addEventListener(STUDIO_DOMAINS_CHANGED, refresh);
    return () => window.removeEventListener(STUDIO_DOMAINS_CHANGED, refresh);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void listStudioDomains(services).then(
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
  const domain = selectStudioDomain(domains, current.domain, current.agencyId);
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
                summarizeStudioObject(
                  (row ?? {}) as Parameters<typeof summarizeStudioObject>[0],
                ),
              )
              .filter((row): row is StudioNavigationObject => Boolean(row)),
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
        !isStudioNavigationMessage(event.data)
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
          .map((row) => summarizeStudioObject(row))
          .filter((row): row is StudioNavigationObject => Boolean(row)),
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [domain?.id]);
  const children = useMemo(() => {
    if (!enabled) return [];
    const objects =
      snapshot?.domainId === domain?.id ? (snapshot?.objects ?? []) : [];
    return studioSidebarChildren(objects.map(object => ({...object,label:localizedExtensionObjectLabel(object.name,object.label,locale)})), domain?.id, current.object).map(item => item.id === "studio:admin" ? {...item,label:locale === "en" ? "Manage" : locale === "pt" ? "Administrar" : "Administrar"} : item);
  }, [enabled, snapshot, domain?.id, domains, current.object, locale]);
  return { agencyId: domain?.agencyId, domainId: domain?.id, children };
}
