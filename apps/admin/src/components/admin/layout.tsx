import { DeploymentUpdateNotice } from "@/pwa/deployment-recovery-ui";
import { PwaInstallBanner } from "@/pwa";
import type { ErrorInfo } from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CoreLayoutProps } from "ra-core";
import { useTranslate } from "ra-core";
import { ErrorBoundary } from "react-error-boundary";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Notification } from "@/components/admin/notification";
import { AppSidebar } from "@/components/admin/app-sidebar";
import { Error } from "@/components/admin/error";
import { Loading } from "@/components/admin/loading";
import { SaviaRequestProvider } from "@/features/savia-request/savia-request-provider";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { ArrowLeft, ArrowRight } from "lucide-react";

const AssistantBar = lazy(async () => {
  const module = await import("@/features/assistant/assistant-bar");
  return { default: module.AssistantBar };
});

function GlobalHistoryNav() {
  const translate = useTranslate();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const backStack = useRef<string[]>([]);
  const forwardStack = useRef<string[]>([]);
  const skipHistorySync = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const route = location.pathname + location.search + location.hash;

  const syncControls = () => {
    setCanGoBack(backStack.current.length > 1);
    setCanGoForward(forwardStack.current.length > 0);
  };

  useEffect(() => {
    if (skipHistorySync.current) {
      skipHistorySync.current = false;
      return;
    }

    const back = backStack.current;
    if (!back.length) {
      backStack.current = [route];
    } else if (back.at(-1) !== route) {
      const previousIndex = back.lastIndexOf(route);
      if (navigationType === "POP") {
        backStack.current =
          previousIndex >= 0 ? back.slice(0, previousIndex + 1) : [route];
        forwardStack.current = [];
      } else {
        forwardStack.current = [];
        backStack.current = [...back, route];
      }
    }
    syncControls();
  }, [navigationType, route]);

  const goBack = () => {
    if (backStack.current.length <= 1) return;
    const current = backStack.current.pop();
    if (!current) return;
    forwardStack.current.push(current);
    const previous = backStack.current.at(-1);
    if (!previous) return;
    skipHistorySync.current = true;
    syncControls();
    navigate(previous);
  };

  const goForward = () => {
    const next = forwardStack.current.pop();
    if (!next) return;
    backStack.current.push(next);
    skipHistorySync.current = true;
    syncControls();
    navigate(next);
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={translate("savia.layout.back")}
        title={
          canGoBack
            ? translate("savia.layout.back")
            : translate("savia.layout.noPreviousScreen")
        }
        disabled={!canGoBack}
        onClick={goBack}
      >
        <ArrowLeft aria-hidden="true" size={17} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={translate("savia.layout.forward")}
        title={
          canGoForward
            ? translate("savia.layout.forward")
            : translate("savia.layout.noNextScreen")
        }
        disabled={!canGoForward}
        onClick={goForward}
      >
        <ArrowRight aria-hidden="true" size={17} />
      </Button>
    </div>
  );
}

/**
 * The main application layout with sidebar, header, and content area.
 *
 * Renders the app structure with a collapsible sidebar, header with breadcrumb navigation,
 * theme toggle, user menu, and main content area. Includes error boundary and loading states.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/layout/ Layout documentation}
 */
function LayoutSidebarTrigger() {
  const translate = useTranslate();
  const label = translate("savia.layout.toggleSidebar");
  return (
    <SidebarTrigger
      aria-label={label}
      className="size-8 scale-125 sm:scale-100"
      title={label}
    />
  );
}

export const Layout = (props: CoreLayoutProps) => {
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | undefined>(undefined);
  const handleError = (_: unknown, info: ErrorInfo) => {
    setErrorInfo(info);
  };
  return (
    <SidebarProvider>
      <SaviaRequestProvider>
        <AppSidebar />
        <main
          className={cn(
            "ml-auto min-w-0 w-full max-w-full overflow-x-hidden",
            "md:peer-data-[state=collapsed]:w-[calc(100%-var(--sidebar-width-icon)-1rem)]",
            "md:peer-data-[state=expanded]:w-[calc(100%-var(--sidebar-width))]",
            "sm:transition-[width] sm:duration-200 sm:ease-linear",
            "group-data-[resizing]/sidebar-wrapper:transition-none",
            "flex h-svh flex-col",
            "group-data-[scroll-locked=1]/body:h-full",
            "has-[main.fixed-main]:group-data-[scroll-locked=1]/body:h-svh",
          )}
        >
          <header className="relative flex h-16 md:h-12 shrink-0 items-center gap-2 px-3 sm:px-4">
            <LayoutSidebarTrigger />
            <GlobalHistoryNav />
            <div
              className="min-w-0 flex flex-1 items-center pr-2"
              id="breadcrumb"
            />
            <div
              id="header-actions"
              className="flex min-w-0 shrink-0 items-center gap-1"
            >
              <NotificationBell />
            </div>
          </header>
          <DeploymentUpdateNotice />
          <ErrorBoundary
            onError={handleError}
            fallbackRender={({ error, resetErrorBoundary }) => (
              <Error
                error={error}
                errorInfo={errorInfo}
                resetErrorBoundary={resetErrorBoundary}
              />
            )}
          >
            <Suspense fallback={<Loading />}>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pb-6 sm:px-4">
                {props.children}
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </SaviaRequestProvider>
      <Notification />
      <PwaInstallBanner />
      <Suspense fallback={null}>
        <AssistantBar />
      </Suspense>
    </SidebarProvider>
  );
};
