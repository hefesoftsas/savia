import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SidebarMenu, useSidebar } from "@/components/ui/sidebar";
import { useTranslate } from "ra-core";
import { ColorThemeToggle } from "@/components/admin/color-theme-toggle";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";

/**
 * Sidebar footer panel for palette and light/dark mode.
 * Collapses to a compact header so the account block stays visible.
 */
export function AppearancePanel() {
  const { state } = useSidebar();
  const translate = useTranslate();
  const iconCollapsed = state === "collapsed";
  const [open, setOpen] = useState(true);

  if (iconCollapsed) {
    return (
      <SidebarMenu>
        <ColorThemeToggle />
        <ThemeModeToggle />
      </SidebarMenu>
    );
  }

  return (
    <Collapsible
      className="group/appearance rounded-xl bg-sidebar-foreground/[0.06] p-1"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger
        aria-label={
          open
            ? translate("savia.appearance.hide")
            : translate("savia.appearance.show")
        }
        className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <span className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {translate("savia.appearance.title")}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="ml-auto size-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]/appearance:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenu>
          <ColorThemeToggle />
          <ThemeModeToggle />
        </SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}
