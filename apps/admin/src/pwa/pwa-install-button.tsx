import { Download } from "lucide-react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { usePwaInstall } from "./use-pwa-install";
import { usePwaInstallAction } from "./use-pwa-install-action";
import { PwaInstallDialog } from "./pwa-install-dialog";
import { cn } from "@/lib/utils";

export type PwaInstallButtonProps = {
  variant?: "header" | "sidebar" | "menu";
  className?: string;
  onAction?: () => void;
};

export function PwaInstallButton({
  variant = "header",
  className,
  onAction,
}: PwaInstallButtonProps) {
  const translate = useTranslate();
  const { isInstalled, isInstallable } = usePwaInstall();
  const { platform, dialogOpen, setDialogOpen, handleInstall } =
    usePwaInstallAction({ onAction });

  // Single source of truth for visibility: never render once installed.
  if (isInstalled || !isInstallable) {
    return null;
  }

  const label = translate("savia.pwa.installApp", {
    _: "Instalar aplicación",
  });
  const shortLabel = translate("savia.pwa.installAppShort", {
    _: "Instalar app",
  });

  return (
    <>
      {variant === "header" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleInstall}
          title={label}
          aria-label={label}
          className={cn(
            "h-8 gap-1.5 rounded-lg border-primary/40 bg-primary/5 px-2.5 text-xs font-semibold text-primary hover:bg-primary/15 hover:text-primary transition-colors shadow-2xs",
            className,
          )}
        >
          <Download className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{shortLabel}</span>
        </Button>
      )}

      {variant === "sidebar" && (
        <SidebarMenuButton
          type="button"
          size="default"
          onClick={handleInstall}
          tooltip={label}
          aria-label={label}
          className={cn(
            "w-full cursor-pointer gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20 hover:text-primary transition-colors",
            className,
          )}
        >
          <Download className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate group-data-[collapsible=icon]:hidden">
            {label}
          </span>
        </SidebarMenuButton>
      )}

      {variant === "menu" && (
        <DropdownMenuItem
          onClick={handleInstall}
          className={cn(
            "cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium",
            className,
          )}
        >
          <Download className="size-4 text-muted-foreground" />
          <span>{label}</span>
        </DropdownMenuItem>
      )}

      <PwaInstallDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        platform={platform}
      />
    </>
  );
}
