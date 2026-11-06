import Menu from "lucide-react/icons/menu";
import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router";
import { Toaster } from "sonner";

import { PageProvider } from "@/components/page-context";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { NavMainProps } from "@/components/sidebar/nav-main";
import * as Sidebar from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";

interface AppLayoutProps {
  children: ReactNode;
  className?: string;
  sidebar?: {
    title: string;
    groups: NavMainProps["groups"];
    footerItems?: NavMainProps["footerItems"];
  };
}

function MobileNavigation({ title }: { title: string }) {
  const { toggleSidebar, setOpenMobile } = Sidebar.useSidebar();
  const { pathname } = useLocation();
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
        aria-label="Open navigation"
        onClick={toggleSidebar}
      >
        <Menu className="size-4" />
      </Button>
      <span className="text-sm font-semibold">{title}</span>
    </div>
  );
}

export function AppLayout({ children, sidebar, className }: AppLayoutProps) {
  return (
    <PageProvider>
      <div className="flex h-screen w-screen overflow-hidden flex-col">
        <Toaster />
        <div className="flex flex-1 overflow-hidden">
          {sidebar ? (
            <Sidebar.SidebarProvider>
              <AppSidebar
                title={sidebar.title}
                groups={sidebar.groups}
                footerItems={sidebar.footerItems}
              />
              <Sidebar.SidebarInset className="bg-background">
                <MobileNavigation title={sidebar.title} />
                <div className="min-h-0 w-full flex-1 overflow-y-auto">
                  {children}
                </div>
              </Sidebar.SidebarInset>
            </Sidebar.SidebarProvider>
          ) : (
            <div
              className={cn(
                "relative flex w-full flex-1 flex-col bg-background overflow-auto",
                className,
              )}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </PageProvider>
  );
}
