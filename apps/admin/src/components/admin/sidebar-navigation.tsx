import { useMemo } from "react";
import {
  useCanAccessResources,
  useHasDashboard,
  useResourceDefinitions,
  useTranslate,
} from "ra-core";
import { useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarDays,
  Workflow,
  House,
  Link2,
  KeyRound,
  ListTree,
  UsersRound,
} from "lucide-react";
import {
  sidebarNavigationItemIds,
  type SidebarNavigationItemId,
  type StaticSidebarNavigationItemId,
  type SidebarNavigationLayout,
  type SidebarNavigationSection,
} from "@/api/user-preferences-client";
import {
  defaultSidebarNavigationLayout,
  reconcileSidebarNavigation,
} from "./sidebar-navigation-layout";

export type {
  SidebarNavigationItemId,
  SidebarNavigationLayout,
  SidebarNavigationSection,
};

export {
  defaultSidebarNavigationLayout,
  reconcileSidebarNavigation,
} from "./sidebar-navigation-layout";

export type SidebarNavigationItem = {
  id: SidebarNavigationItemId;
  label: string;
  labelKey?: string;
  route: string;
  section: SidebarNavigationSection;
  icon: LucideIcon | string;
  active: boolean;
  count?: number;
};

export const sidebarNavigationSections = [
  { id: "operation", labelKey: "savia.sidebar.sections.operation" },
  { id: "productivity", labelKey: "savia.sidebar.sections.productivity" },
  { id: "administration", labelKey: "savia.sidebar.sections.administration" },
  { id: "management", labelKey: "savia.sidebar.sections.management" },
] as const satisfies ReadonlyArray<{
  id: SidebarNavigationSection;
  labelKey: string;
}>;

const navigationDefinitions: Record<
  StaticSidebarNavigationItemId,
  Omit<SidebarNavigationItem, "active" | "label" | "labelKey"> & {
    labelKey: string;
  }
> = {
  "access-control": {
    id: "access-control",
    labelKey: "savia.sidebar.items.access-control",
    route: "/roles",
    section: "administration",
    icon: KeyRound,
  },
  "dynamic-crm": {
    id: "dynamic-crm",
    labelKey: "savia.sidebar.items.dynamic-crm",
    route: "/crm",
    section: "operation",
    icon: UsersRound,
  },
  dashboard: {
    id: "dashboard",
    labelKey: "savia.sidebar.items.dashboard",
    route: "/",
    section: "operation",
    icon: House,
  },
  "my-day": {
    id: "my-day",
    labelKey: "savia.sidebar.items.my-day",
    route: "/my-day",
    section: "productivity",
    icon: CalendarDays,
  },
  integrations: {
    id: "integrations",
    labelKey: "savia.sidebar.items.integrations",
    route: "/my-integrations",
    section: "productivity",
    icon: Link2,
  },
  "provider-credentials": {
    id: "provider-credentials",
    labelKey: "savia.sidebar.items.provider-credentials",
    route: "/savia-request",
    section: "administration",
    icon: Workflow,
  },
  "service-credentials": {
    id: "service-credentials",
    labelKey: "savia.sidebar.items.service-credentials",
    route: "/service-credentials",
    section: "administration",
    icon: KeyRound,
  },
  "assistant-configuration": {
    id: "assistant-configuration",
    labelKey: "savia.sidebar.items.assistant-configuration",
    route: "/assistant-configuration",
    section: "administration",
    icon: KeyRound,
  },
  tenants: {
    id: "tenants",
    labelKey: "savia.sidebar.items.tenants",
    route: "/tenants",
    section: "management",
    icon: Building2,
  },
  users: {
    id: "users",
    labelKey: "savia.sidebar.items.users",
    route: "/users",
    section: "management",
    icon: UsersRound,
  },
  "page-administrator": {
    id: "page-administrator",
    labelKey: "savia.sidebar.items.page-administrator",
    route: "/crm",
    section: "management",
    icon: ListTree,
  },
};

const resourceNavigationIds = new Set<SidebarNavigationItemId>([
  "users",
  "tenants",
]);

export function useVisibleSidebarNavigation(): {
  isLoading: boolean;
  layout: SidebarNavigationLayout;
  itemsById: Partial<Record<SidebarNavigationItemId, SidebarNavigationItem>>;
} {
  const resources = useResourceDefinitions();
  const hasDashboard = useHasDashboard();
  const location = useLocation();
  const translate = useTranslate();
  const { canAccess, isPending } = useCanAccessResources({
    action: "list",
    resources: [...sidebarNavigationItemIds, "savia-request"],
  });

  return useMemo(() => {
    if (isPending || !canAccess) {
      return {
        isLoading: true,
        layout: defaultSidebarNavigationLayout(),
        itemsById: {},
      };
    }

    const visibleItemIds = sidebarNavigationItemIds.filter((id) => {
      if (id === "assistant-configuration" || id === "page-administrator")
        return false;
      const permissionResource =
        id === "provider-credentials" ? "savia-request" : id;
      if (id === "service-credentials")
        return canAccess["dynamic-crm"] || canAccess["savia-request"];
      if (id !== "provider-credentials" && !canAccess[permissionResource])
        return false;
      if (id === "dashboard") return hasDashboard;
      if (resourceNavigationIds.has(id)) return Boolean(resources[id]?.hasList);
      return true;
    });
    const itemsById = Object.fromEntries(
      visibleItemIds.map((id) => {
        const definition = navigationDefinitions[id];
        return [
          id,
          {
            ...definition,
            label: translate(definition.labelKey),
            active:
              definition.route === "/"
                ? location.pathname === "/" || location.pathname === "/my-day"
                : location.pathname.startsWith(definition.route),
          },
        ];
      }),
    ) as Partial<Record<SidebarNavigationItemId, SidebarNavigationItem>>;

    return {
      isLoading: false,
      layout: reconcileSidebarNavigation(
        defaultSidebarNavigationLayout(),
        visibleItemIds,
      ),
      itemsById,
    };
  }, [
    canAccess,
    hasDashboard,
    isPending,
    location.pathname,
    resources,
    translate,
  ]);
}
