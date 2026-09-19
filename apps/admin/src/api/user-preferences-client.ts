import type { ApiClient } from "./api-client";

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

export type SidebarNavigationBlock =
  SidebarNavigationBuiltinBlock | SidebarNavigationCustomBlock;

export type SidebarNavigationLayout = {
  version: 2;
  presetVersion?: 2;
  blocks: SidebarNavigationBlock[];
  hiddenItems?: SidebarNavigationItemId[];
};

export type AppearanceThemeMode = "light" | "dark" | "system";

export type AppearanceColorTheme =
  | "emerald"
  | "blue"
  | "indigo"
  | "violet"
  | "rose"
  | "teal"
  | "sky"
  | "orange"
  | "amber"
  | "neutral"
  | "stone"
  | "zinc"
  | "mauve"
  | "olive"
  | "mist"
  | "taupe";

export type AppearancePreferences = {
  version: 1;
  theme: AppearanceThemeMode;
  colorTheme: AppearanceColorTheme;
};

export class UserPreferencesClient {
  constructor(private readonly api: ApiClient) {}

  async getSidebarNavigation(): Promise<SidebarNavigationLayout> {
    return (
      await this.api.get<{ data: SidebarNavigationLayout }>(
        "/v1/user-preferences/sidebar-navigation",
      )
    ).data;
  }

  async saveSidebarNavigation(
    layout: SidebarNavigationLayout,
  ): Promise<SidebarNavigationLayout> {
    return (
      await this.api.put<{ data: SidebarNavigationLayout }>(
        "/v1/user-preferences/sidebar-navigation",
        layout,
      )
    ).data;
  }

  async getAppearance(): Promise<AppearancePreferences> {
    return (
      await this.api.get<{ data: AppearancePreferences }>(
        "/v1/user-preferences/appearance",
      )
    ).data;
  }

  async saveAppearance(
    settings: AppearancePreferences,
  ): Promise<AppearancePreferences> {
    return (
      await this.api.put<{ data: AppearancePreferences }>(
        "/v1/user-preferences/appearance",
        settings,
      )
    ).data;
  }
}
