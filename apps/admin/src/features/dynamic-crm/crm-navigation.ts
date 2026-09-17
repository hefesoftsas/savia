import {
  screenNavigationIconSchema,
  screenNavigationSectionSchema,
  type ScreenNavigationSection,
} from "@savia/crm-shared/metadata";

export const CRM_NAVIGATION_MESSAGE = "savia-crm-navigation";

export type CrmNavigationObject = {
  name: string;
  label: string;
  count?: number;
  hidden: boolean;
  section?: ScreenNavigationSection;
  icon?: string;
};

export type CrmStudioView =
  | "admin"
  | "new-object"
  | "operations"
  | "screens"
  | "designer"
  | "integrations"
  | "audit";

export type CrmSidebarChild = {
  id: string;
  label: string;
  route: string;
  count?: number;
  group: "objects" | "studio";
  removeRoute?: string;
  section?: ScreenNavigationSection;
  icon?: string;
};

export const crmStudioItems: ReadonlyArray<{
  id: CrmStudioView;
  label: string;
  view: CrmStudioView;
}> = [{ id: "admin", label: "Administrar", view: "admin" }];

export function isCrmNavigationMessage(data: unknown): data is {
  type: typeof CRM_NAVIGATION_MESSAGE;
  objects: CrmNavigationObject[];
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const message = data as {
    type?: unknown;
    objects?: unknown;
  };
  return (
    message.type === CRM_NAVIGATION_MESSAGE && Array.isArray(message.objects)
  );
}

export function crmHref(input: {
  domain?: string;
  agencyId?: number;
  object?: string;
  view?: string;
}): string {
  const search = new URLSearchParams();
  if (input.domain) search.set("domain", input.domain);
  else if (input.agencyId) search.set("agencyId", String(input.agencyId));
  if (input.object) search.set("object", input.object);
  if (input.view && input.view !== "records") search.set("view", input.view);
  const query = search.toString();
  return query ? `/crm?${query}` : "/crm";
}

export function visibleCrmObjects(
  objects: readonly CrmNavigationObject[],
): CrmNavigationObject[] {
  return objects.filter((object) => !object.hidden);
}

export function crmSidebarChildren(
  objects: readonly CrmNavigationObject[],
  domain?: string | number,
  currentObject?: string,
): CrmSidebarChild[] {
  const visible = visibleCrmObjects(objects);
  const scope = typeof domain === "number" ? { agencyId: domain } : { domain };
  const fallbackObject = currentObject ?? visible[0]?.name;
  return [
    ...visible.map((object) => ({
      id: `object:${object.name}`,
      label: object.label,
      count: objects.some((existing) => existing.name === object.name)
        ? object.count
        : undefined,
      group: "objects" as const,
      route: crmHref({
        ...scope,
        object: object.name,
        view: "records",
      }),
      removeRoute: objects.some((existing) => existing.name === object.name)
        ? crmHref({
            ...scope,
            object: object.name,
            view: "remove-screen",
          })
        : undefined,
      ...(object.section ? { section: object.section } : {}),
      ...(object.icon ? { icon: object.icon } : {}),
    })),
    ...crmStudioItems.map((item) => ({
      id: `studio:${item.id}`,
      label: item.label,
      group: "studio" as const,
      route: crmHref({
        ...scope,
        object: fallbackObject,
        view: item.view,
      }),
    })),
  ];
}

export function parseCrmSearch(search: string): {
  domain?: string;
  agencyId?: number;
  object?: string;
  view: string;
} {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const agencyId = Number(params.get("agencyId"));
  return {
    domain: params.get("domain") ?? undefined,
    agencyId:
      Number.isSafeInteger(agencyId) && agencyId > 0 ? agencyId : undefined,
    object: params.get("object") ?? undefined,
    view: params.get("view") ?? "records",
  };
}

export function isCrmChildActive(
  child: CrmSidebarChild,
  search: string,
): boolean {
  const current = parseCrmSearch(search);
  const target = parseCrmSearch(child.route.split("?")[1] ?? "");
  if (target.domain && current.domain && target.domain !== current.domain)
    return false;
  if (child.id.startsWith("object:")) {
    const name = child.id.slice("object:".length);
    return (
      current.object === name &&
      (current.view === "records" ||
        current.view === "create" ||
        current.view === "edit" ||
        current.view === "remove-screen")
    );
  }
  const view = child.id.slice("studio:".length);
  return view === "admin"
    ? !["records", "create", "edit", "remove-screen"].includes(current.view)
    : current.view === view;
}

export function summarizeCrmObject(input: {
  name?: unknown;
  label?: unknown;
  count?: unknown;
  hidden?: boolean;
  config?: {
    studio?: {
      requestPage?: unknown;
      screen?: { hidden?: boolean; section?: unknown; icon?: unknown };
    };
  };
}): CrmNavigationObject | null {
  if (typeof input.name !== "string" || !input.name) return null;
  const section = screenNavigationSectionSchema.safeParse(
    input.config?.studio?.screen?.section,
  );
  const icon = screenNavigationIconSchema.safeParse(
    input.config?.studio?.screen?.icon,
  );
  return {
    name: input.name,
    label:
      typeof input.label === "string" && input.label ? input.label : input.name,
    count:
      input.config?.studio?.requestPage ||
      input.count === undefined ||
      input.count === null
        ? undefined
        : Number(input.count) || 0,
    hidden: Boolean(input.hidden ?? input.config?.studio?.screen?.hidden),
    ...(section.success ? { section: section.data } : {}),
    ...(icon.success ? { icon: icon.data } : {}),
  };
}
