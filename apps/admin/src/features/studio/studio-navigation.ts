import {
  screenNavigationIconSchema,
  screenNavigationSectionSchema,
  type ScreenNavigationSection,
} from "@savia/studio-shared/metadata";

export const STUDIO_NAVIGATION_MESSAGE = "savia-studio-navigation";
/** Legacy alias from Fase 1 (savia-crm-navigation); accepted during rollout. */
export const STUDIO_NAVIGATION_MESSAGE_LEGACY = "savia-crm-navigation";

/** Carry navigation intent across workspaces, never a record or screen identity. */
export function studioTenantSearch(current: URLSearchParams, tenantId: number) {
  const next = new URLSearchParams();
  next.set("tenantId", String(tenantId));
  const view = current.get("view") ?? "records";
  const workspaceViews = new Set([
    "admin",
    "screens",
    "new-object",
    "integrations",
    "operations",
    "audit",
    "collection-sources",
    "service-credentials",
    "import-spreadsheet",
    "request-page-generator",
  ]);
  const target = view.startsWith("admin")
    ? "admin"
    : workspaceViews.has(view)
      ? view
      : "records";
  next.set("view", target);
  const tab = current.get("tab");
  if (target === "admin" && (tab === "screens" || tab === "packages"))
    next.set("tab", tab);
  if (target === "screens" && (tab === "screens" || tab === "menu"))
    next.set("tab", tab);
  return next;
}

export type StudioNavigationObject = {
  name: string;
  label: string;
  count?: number;
  hidden: boolean;
  section?: ScreenNavigationSection;
  icon?: string;
};

export type StudioView =
  | "admin"
  | "new-object"
  | "operations"
  | "screens"
  | "designer"
  | "integrations"
  | "audit";

export type StudioSidebarChild = {
  id: string;
  label: string;
  route: string;
  count?: number;
  group: "objects" | "studio";
  removeRoute?: string;
  section?: ScreenNavigationSection;
  icon?: string;
};

export const studioItems: ReadonlyArray<{
  id: StudioView;
  label: string;
  view: StudioView;
}> = [{ id: "admin", label: "Administrar", view: "admin" }];

export function isStudioNavigationMessage(data: unknown): data is {
  type: typeof STUDIO_NAVIGATION_MESSAGE;
  objects: StudioNavigationObject[];
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const message = data as {
    type?: unknown;
    objects?: unknown;
  };
  return (
    (message.type === STUDIO_NAVIGATION_MESSAGE ||
      message.type === STUDIO_NAVIGATION_MESSAGE_LEGACY) &&
    Array.isArray(message.objects)
  );
}

export function studioHref(input: {
  tenantId?: number;
  object?: string;
  view?: string;
  tab?: string;
}): string {
  const search = new URLSearchParams();
  if (input.tenantId !== undefined)
    search.set("tenantId", String(input.tenantId));
  if (input.object) search.set("object", input.object);
  if (input.view && input.view !== "records") search.set("view", input.view);
  if (input.tab) search.set("tab", input.tab);
  const query = search.toString();
  // Fase 1: ruta canónica #/studio; #/crm se mantiene como alias legacy.
  return query ? `/studio?${query}` : "/studio";
}

const TENANT_API_ID_PATTERN = /^\/v1\/(?:studio|dynamic-crm)\/(\d+)$/;
const TENANT_API_PREFIX_PATTERN = /^\/v1\/(?:studio|dynamic-crm)\/.+$/;

/**
 * Numeric agency id from an agency workspace API base. Canonical is
 * `/v1/studio/:id`; `/v1/dynamic-crm/:id` stays as a legacy alias.
 */
export function matchTenantApiBasePath(
  apiBasePath: string | undefined,
): string | undefined {
  if (!apiBasePath) return undefined;
  return TENANT_API_ID_PATTERN.exec(apiBasePath)?.[1];
}

/** Agency workspace API base (any scope id), both prefixes. */
export function isTenantApiBasePath(apiBasePath: string | undefined): boolean {
  return (
    typeof apiBasePath === "string" &&
    TENANT_API_PREFIX_PATTERN.test(apiBasePath)
  );
}

export function visibleStudioObjects(
  objects: readonly StudioNavigationObject[],
): StudioNavigationObject[] {
  return objects.filter((object) => !object.hidden);
}

export function studioSidebarChildren(
  objects: readonly StudioNavigationObject[],
  tenantId?: number,
  currentObject?: string,
): StudioSidebarChild[] {
  const visible = visibleStudioObjects(objects);
  const scope = tenantId !== undefined ? { tenantId } : {};
  const fallbackObject = currentObject ?? visible[0]?.name;
  return [
    ...visible.map((object) => ({
      id: `object:${object.name}`,
      label: object.label,
      count: objects.some((existing) => existing.name === object.name)
        ? object.count
        : undefined,
      group: "objects" as const,
      route: studioHref({
        ...scope,
        object: object.name,
        view: "records",
      }),
      removeRoute: objects.some((existing) => existing.name === object.name)
        ? studioHref({
            ...scope,
            object: object.name,
            view: "remove-screen",
          })
        : undefined,
      ...(object.section ? { section: object.section } : {}),
      ...(object.icon ? { icon: object.icon } : {}),
    })),
    ...studioItems.map((item) => ({
      id: `studio:${item.id}`,
      label: item.label,
      group: "studio" as const,
      route: studioHref({
        ...scope,
        object: fallbackObject,
        view: item.view,
      }),
    })),
  ];
}

export function parseStudioSearch(search: string): {
  tenantId?: number;
  object?: string;
  view: string;
} {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const rawTenantId = params.get("tenantId");
  const tenantId = Number(rawTenantId);
  return {
    tenantId:
      rawTenantId !== null &&
      /^\d+$/.test(rawTenantId) &&
      Number.isSafeInteger(tenantId)
        ? tenantId
        : undefined,
    object: params.get("object") ?? undefined,
    view: params.get("view") ?? "records",
  };
}

export function isStudioChildActive(
  child: StudioSidebarChild,
  search: string,
): boolean {
  const current = parseStudioSearch(search);
  const target = parseStudioSearch(child.route.split("?")[1] ?? "");
  if (target.tenantId !== undefined && current.tenantId !== target.tenantId)
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

export function summarizeStudioObject(input: {
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
}): StudioNavigationObject | null {
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
