import type { MyDayWidgetsLayout } from "@savia/crm-shared/my-day-widgets";

export const sidebarNavigationSectionIds = [
  "operation",
  "productivity",
  "administration",
  "management",
] as const;
export const sidebarNavigationItemIds = [
  "dashboard",
  "dynamic-crm",
  "my-day",
  "integrations",
  "provider-credentials",
  "assistant-configuration",
  "service-credentials",
  "access-control",
  "users",
  "tenants",
  "page-administrator",
  "domain-sources",
  "domain-workflows",
  "domain-reports",
  "domain-api",
  "domain-history",
  "domain-packages",
  "virtual-employees",
  "tenant-branding",
] as const;

export type SidebarNavigationSection =
  (typeof sidebarNavigationSectionIds)[number];
export type StaticSidebarNavigationItemId =
  (typeof sidebarNavigationItemIds)[number];
export type SidebarNavigationItemId =
  StaticSidebarNavigationItemId | `page:${string}:${string}`;

export type SidebarNavigationLayoutV1 = {
  version: 1;
  sections: Record<SidebarNavigationSection, SidebarNavigationItemId[]>;
};

export type SidebarNavigationBuiltinBlock = {
  kind: "builtin";
  id: SidebarNavigationSection;
  items: SidebarNavigationItemId[];
  collapsed: boolean;
};

export type SidebarNavigationCustomBlock = {
  kind: "custom";
  id: `custom:${string}`;
  label: string;
  items: SidebarNavigationItemId[];
  collapsed: boolean;
};

type SidebarNavigationBlockInput =
  | (Omit<SidebarNavigationBuiltinBlock, "collapsed"> & {
      collapsed?: boolean;
    })
  | (Omit<SidebarNavigationCustomBlock, "collapsed"> & {
      collapsed?: boolean;
    });

type SidebarNavigationLayoutInput = {
  version: 2;
  presetVersion?: 2;
  blocks: SidebarNavigationBlockInput[];
  hiddenItems?: SidebarNavigationItemId[];
};

export type SidebarNavigationBlock =
  SidebarNavigationBuiltinBlock | SidebarNavigationCustomBlock;

export type SidebarNavigationLayout = {
  version: 2;
  presetVersion?: 2;
  blocks: SidebarNavigationBlock[];
  hiddenItems?: SidebarNavigationItemId[];
};

export type UserPreferencesRepository = {
  getSidebarNavigation(
    principalId: string,
  ): Promise<SidebarNavigationLayout | undefined>;
  saveSidebarNavigation(
    principalId: string,
    layout: SidebarNavigationLayout,
  ): Promise<SidebarNavigationLayout>;
  getAppearance(
    principalId: string,
  ): Promise<AppearancePreferences | undefined>;
  saveAppearance(
    principalId: string,
    settings: AppearancePreferences,
  ): Promise<AppearancePreferences>;
  getMyDayWidgets(principalId: string): Promise<MyDayWidgetsLayout | undefined>;
  saveMyDayWidgets(
    principalId: string,
    layout: MyDayWidgetsLayout,
  ): Promise<MyDayWidgetsLayout>;
};

export const appearanceColorThemeIds = [
  "emerald",
  "blue",
  "indigo",
  "violet",
  "rose",
  "teal",
  "sky",
  "orange",
  "amber",
  "neutral",
  "stone",
  "zinc",
  "mauve",
  "olive",
  "mist",
  "taupe",
] as const;

export type AppearanceColorTheme = (typeof appearanceColorThemeIds)[number];
export type AppearanceThemeMode = "light" | "dark" | "system";

export type AppearancePreferences = {
  version: 1;
  theme: AppearanceThemeMode;
  colorTheme: AppearanceColorTheme;
};

export function defaultAppearancePreferences(): AppearancePreferences {
  return { version: 1, theme: "light", colorTheme: "emerald" };
}

export class AppearancePreferencesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppearancePreferencesError";
  }
}

export function parseAppearancePreferences(
  value: unknown,
): AppearancePreferences {
  if (!isRecord(value) || value.version !== 1) {
    throw new AppearancePreferencesError("Appearance preferences are invalid");
  }
  if (
    value.theme !== "light" &&
    value.theme !== "dark" &&
    value.theme !== "system"
  ) {
    throw new AppearancePreferencesError("Appearance theme mode is invalid");
  }
  if (
    typeof value.colorTheme !== "string" ||
    !(appearanceColorThemeIds as readonly string[]).includes(value.colorTheme)
  ) {
    throw new AppearancePreferencesError("Appearance color theme is invalid");
  }
  return {
    version: 1,
    theme: value.theme,
    colorTheme: value.colorTheme as AppearanceColorTheme,
  };
}

export class SidebarNavigationLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidebarNavigationLayoutError";
  }
}

export function defaultSidebarNavigationLayout(): SidebarNavigationLayout {
  return {
    ...normalizeSidebarNavigationLayout({
      version: 1,
      sections: {
        operation: ["my-day", "dashboard", "dynamic-crm", "domain-reports"],
        productivity: [
          "page-administrator",
          "domain-sources",
          "domain-workflows",
          "domain-api",
          "provider-credentials",
          "virtual-employees",
          "integrations",
          "domain-packages",
        ],
        administration: [
          "users",
          "access-control",
          "service-credentials",
          "tenant-branding",
          "domain-history",
        ],
        management: ["tenants"],
      },
    }),
    presetVersion: 2,
  };
}

function parseItemId(
  itemId: unknown,
  seen: Set<string>,
): SidebarNavigationItemId {
  if (
    typeof itemId !== "string" ||
    (!(sidebarNavigationItemIds as readonly string[]).includes(itemId) &&
      !/^page:[a-zA-Z0-9_%.-]{1,160}:[a-z][a-z0-9_]{0,47}$/.test(itemId))
  ) {
    throw new SidebarNavigationLayoutError(
      "Sidebar navigation item is invalid",
    );
  }
  if (seen.has(itemId)) {
    throw new SidebarNavigationLayoutError(
      "Sidebar navigation item is duplicated",
    );
  }
  seen.add(itemId);
  return itemId as SidebarNavigationItemId;
}

function parseBlockItems(
  value: unknown,
  seen: Set<string>,
): SidebarNavigationItemId[] {
  if (!Array.isArray(value)) {
    throw new SidebarNavigationLayoutError(
      "Sidebar navigation section is invalid",
    );
  }
  return value.map((itemId) => parseItemId(itemId, seen));
}

export function normalizeSidebarNavigationLayout(
  value:
    | SidebarNavigationLayout
    | SidebarNavigationLayoutV1
    | SidebarNavigationLayoutInput,
): SidebarNavigationLayout {
  const hiddenItems =
    "hiddenItems" in value && Array.isArray(value.hiddenItems)
      ? [...value.hiddenItems]
      : undefined;
  if (value.version === 2) {
    return {
      version: 2,
      ...("presetVersion" in value && value.presetVersion === 2
        ? { presetVersion: 2 as const }
        : {}),
      blocks: value.blocks.map((block) =>
        block.kind === "builtin"
          ? {
              kind: "builtin",
              id: block.id,
              items: [...block.items],
              collapsed: block.collapsed === true,
            }
          : {
              kind: "custom",
              id: block.id,
              label: block.label,
              items: [...block.items],
              collapsed: block.collapsed === true,
            },
      ),
      ...(hiddenItems ? { hiddenItems } : {}),
    };
  }
  return {
    version: 2,
    blocks: sidebarNavigationSectionIds.map((id) => ({
      kind: "builtin",
      id,
      items: [...value.sections[id]],
      collapsed: false,
    })),
    ...(hiddenItems ? { hiddenItems } : {}),
  };
}

export function parseSidebarNavigationLayout(
  value: unknown,
): SidebarNavigationLayout {
  if (!isRecord(value)) {
    throw new SidebarNavigationLayoutError(
      "Sidebar navigation layout is invalid",
    );
  }
  if (value.version === 1 && isRecord(value.sections)) {
    const seen = new Set<string>();
    for (const section of sidebarNavigationSectionIds) {
      parseBlockItems(value.sections[section], seen);
    }
    return normalizeSidebarNavigationLayout(value as SidebarNavigationLayoutV1);
  }
  if (value.version !== 2 || !Array.isArray(value.blocks)) {
    throw new SidebarNavigationLayoutError(
      "Sidebar navigation layout is invalid",
    );
  }

  const seen = new Set<string>();
  const blocks: SidebarNavigationBlock[] = value.blocks.map((block) => {
    if (!isRecord(block) || typeof block.kind !== "string") {
      throw new SidebarNavigationLayoutError(
        "Sidebar navigation section is invalid",
      );
    }
    const items = parseBlockItems(block.items, seen);
    if (block.collapsed !== undefined && typeof block.collapsed !== "boolean") {
      throw new SidebarNavigationLayoutError(
        "Sidebar navigation section collapse state is invalid",
      );
    }
    if (block.kind === "builtin") {
      if (
        typeof block.id !== "string" ||
        !(sidebarNavigationSectionIds as readonly string[]).includes(block.id)
      ) {
        throw new SidebarNavigationLayoutError(
          "Sidebar navigation section is invalid",
        );
      }
      return {
        kind: "builtin",
        id: block.id as SidebarNavigationSection,
        items,
        collapsed: block.collapsed === true,
      };
    }
    if (block.kind === "custom") {
      if (
        typeof block.id !== "string" ||
        !/^custom:[a-z0-9_-]{1,48}$/.test(block.id) ||
        typeof block.label !== "string" ||
        block.label.trim().length === 0 ||
        block.label.length > 40
      ) {
        throw new SidebarNavigationLayoutError(
          "Sidebar navigation section is invalid",
        );
      }
      return {
        kind: "custom",
        id: block.id as `custom:${string}`,
        label: block.label.trim(),
        items,
        collapsed: block.collapsed === true,
      };
    }
    throw new SidebarNavigationLayoutError(
      "Sidebar navigation section is invalid",
    );
  });

  for (const section of sidebarNavigationSectionIds) {
    if (
      !blocks.some((block) => block.kind === "builtin" && block.id === section)
    ) {
      throw new SidebarNavigationLayoutError(
        "Sidebar navigation section is invalid",
      );
    }
  }

  let hiddenItems: SidebarNavigationItemId[] | undefined;
  if (value.hiddenItems !== undefined) {
    if (!Array.isArray(value.hiddenItems)) {
      throw new SidebarNavigationLayoutError(
        "Sidebar navigation hidden items are invalid",
      );
    }
    const hiddenSeen = new Set<string>();
    hiddenItems = value.hiddenItems.map((item) =>
      parseItemId(item, hiddenSeen),
    );
  }

  return {
    version: 2,
    ...(value.presetVersion === 2 ? { presetVersion: 2 as const } : {}),
    blocks,
    ...(hiddenItems ? { hiddenItems } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- My Day widgets (schema lives in @savia/crm-shared/my-day-widgets) ---

export type {
  MyDayWidget,
  MyDayWidgetConfig,
  MyDayWidgetsLayout,
} from "@savia/crm-shared/my-day-widgets";
export {
  defaultMyDayWidgets,
  MyDayWidgetsError,
  parseMyDayWidgets,
} from "@savia/crm-shared/my-day-widgets";
