import { useMessages } from "@/i18n/core";
import { settingsMessages } from "@/i18n/locales/settings";
import { Link } from "react-router-dom";
import { AppearancePanel } from "@/components/admin/appearance-panel";
import { Children, useCallback, useEffect, useState } from "react";
import {
  Translate,
  useAuthProvider,
  useGetIdentity,
  useLogout,
  useTranslate,
  UserMenuContext,
} from "ra-core";
import { ChevronsUpDown, ExternalLink, LogOut, Plug } from "lucide-react";
import { usePwaInstall, PwaInstallButton } from "@/pwa";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { LocalesMenuItems } from "@/components/admin/locales-menu-button";

export type UserMenuProps = {
  children?: React.ReactNode;
};

/**
 * A user menu component displayed in the top right corner of the admin layout.
 *
 * Provides access to user-related actions such as profile, settings, and logout.
 * Displays the user's avatar and name from the identity provider, and includes a logout option.
 * Only displays in applications using authentication.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/usermenu UserMenu documentation}
 */
export function UserMenu({ children }: UserMenuProps) {
  const t = useMessages(settingsMessages);
  const authProvider = useAuthProvider();
  const { data: identity, refetch } = useGetIdentity();
  const logout = useLogout();
  const translate = useTranslate();
  const { isMobile } = useSidebar();
  const currentTenant = useCurrentTenant();

  const [open, setOpen] = useState(false);
  const { isInstalled } = usePwaInstall();

  const handleToggleOpen = useCallback(() => {
    setOpen((prevOpen) => !prevOpen);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const refreshIdentity = () => {
      void refetch();
    };
    window.addEventListener("savia:identity-changed", refreshIdentity);
    return () => {
      window.removeEventListener("savia:identity-changed", refreshIdentity);
    };
  }, [refetch]);

  if (!authProvider) return null;

  const defaultAccountLabel = translate("savia.account.myAccount", {
    _: "Mi cuenta",
  });
  const openMenuLabel = translate("savia.userMenu.openMenu", {
    _: "Abrir menú de cuenta",
  });

  return (
    <UserMenuContext.Provider value={{ onClose: handleClose }}>
      <DropdownMenu open={open} onOpenChange={handleToggleOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            aria-label={openMenuLabel}
            size="lg"
            tooltip={openMenuLabel}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar className="size-8 rounded-lg">
              <AvatarImage src={identity?.avatar} role="presentation" />
              <AvatarFallback className="rounded-lg">
                {identity?.fullName?.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span
                className="line-clamp-2 font-medium break-words"
                title={identity?.fullName}
              >
                {identity?.fullName ?? defaultAccountLabel}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {currentTenant.isDedicated
                  ? currentTenant.name
                  : defaultAccountLabel}
              </span>
            </span>
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
            />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-64 rounded-xl border border-border/70 bg-popover/95 p-1.5 shadow-xl shadow-black/8 backdrop-blur-md"
          side={isMobile ? "top" : "right"}
          align="end"
          sideOffset={6}
          forceMount
        >
          <DropdownMenuLabel className="p-2 font-normal">
            <div className="flex items-center gap-3">
              <Avatar className="size-9 rounded-full ring-2 ring-primary/20">
                <AvatarImage src={identity?.avatar} role="presentation" />
                <AvatarFallback className="rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {identity?.fullName?.charAt(0) ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm font-semibold leading-tight text-foreground">
                  {identity?.fullName ??
                    translate("savia.userMenu.fallbackUser", {
                      _: "Usuario",
                    })}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {"email" in (identity ?? {}) &&
                  typeof identity?.email === "string"
                    ? identity.email
                    : translate("savia.userMenu.fallbackPlatform", {
                        _: "Plataforma Savia",
                      })}
                </p>
              </div>
            </div>
            {currentTenant.isDedicated ? (
              <div className="mt-2.5 flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
                <span className="truncate font-medium text-foreground">
                  {currentTenant.name}
                </span>
                <span className="ml-2 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {t("Workspace")}
                </span>
              </div>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            asChild
            onClick={handleClose}
            className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium"
          >
            <Link to="/my-integrations?tab=connections">
              <Plug
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              <span>
                {translate("savia.userMenu.myConnections", {
                  _: "Mis conexiones",
                })}
              </span>
            </Link>
          </DropdownMenuItem>
          <AppearancePanel />
          {children}
          {Children.count(children) > 0 ? (
            <DropdownMenuSeparator className="my-1" />
          ) : null}
          {!isInstalled && (
            <>
              <PwaInstallButton variant="menu" onAction={handleClose} />
              <DropdownMenuSeparator className="my-1" />
            </>
          )}
          <LocalesMenuItems onSelect={handleClose} trailingSeparator />
          {currentTenant.isPlatformAdmin && currentTenant.isDedicated ? (
            <DropdownMenuItem
              asChild
              className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium"
            >
              <a href="https://savia.app.hefesoft.com">
                <ExternalLink className="size-4 text-muted-foreground" />
                <span>
                  {translate("savia.userMenu.platformConsole", {
                    _: "Consola Plataforma",
                  })}
                </span>
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => logout({ logoutFromProvider: true })}
            className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors"
          >
            <LogOut className="size-4" />
            <Translate i18nKey="ra.auth.logout">Log out</Translate>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </UserMenuContext.Provider>
  );
}
