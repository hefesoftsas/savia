import { Moon, Sun } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { useTranslate } from "ra-core";
import { useTheme } from "@/components/admin/use-theme";

/**
 * Switch that lets users move directly between light and dark UI themes.
 *
 * User's selection is persisted using the store.
 * Included in the navigation sidebar footer.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/thememodetoggle ThemeModeToggle documentation}
 */
export function ThemeModeToggle() {
  const { theme, setTheme } = useTheme();
  const translate = useTranslate();
  const isDark = theme === "dark";

  return (
    <SidebarMenuItem>
      <div className="flex h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center">
        {isDark ? (
          <Moon
            aria-hidden="true"
            className="size-4 shrink-0 group-data-[collapsible=icon]:hidden"
          />
        ) : (
          <Sun
            aria-hidden="true"
            className="size-4 shrink-0 group-data-[collapsible=icon]:hidden"
          />
        )}
        <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">
          {isDark
            ? translate("savia.appearance.darkMode")
            : translate("savia.appearance.lightMode")}
        </span>
        <Switch
          aria-label={
            isDark
              ? translate("savia.appearance.enableLightMode")
              : translate("savia.appearance.enableDarkMode")
          }
          checked={isDark}
          onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        />
        <span className="sr-only">
          {isDark
            ? translate("savia.appearance.themeCurrentDark")
            : translate("savia.appearance.themeCurrentLight")}
        </span>
      </div>
    </SidebarMenuItem>
  );
}
