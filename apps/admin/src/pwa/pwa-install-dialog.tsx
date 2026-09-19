import { Share, PlusSquare, Download, Compass, Smartphone, Monitor } from "lucide-react";
import { useTranslate } from "ra-core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PwaPlatform } from "./use-pwa-install";

export type PwaInstallDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform?: PwaPlatform;
};

export function PwaInstallDialog({
  open,
  onOpenChange,
  platform = "other",
}: PwaInstallDialogProps) {
  const translate = useTranslate();

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {platform === "ios" || platform === "android" ? (
              <Smartphone className="size-6" />
            ) : (
              <Download className="size-6" />
            )}
          </div>
          <DialogTitle className="text-center text-xl">
            {translate("savia.pwa.dialogTitle", {
              _: "Instalar Savia en tu dispositivo",
            })}
          </DialogTitle>
          <DialogDescription className="text-center">
            {translate("savia.pwa.dialogSubtitle", {
              _: "Instala Savia como aplicación para acceder rápidamente desde tu escritorio o pantalla de inicio y trabajar a pantalla completa.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {platform === "ios" && (
            <>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  1
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {translate("savia.pwa.iosStep1Title", {
                      _: "Pulsa el botón de Compartir",
                    })}
                  </p>
                  <p className="text-muted-foreground flex items-center gap-1.5 pt-0.5">
                    {translate("savia.pwa.iosStep1Desc", {
                      _: "En la barra inferior o superior de Safari, toca",
                    })}
                    <Share className="inline size-4 text-primary" aria-label="Compartir" />
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  2
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {translate("savia.pwa.iosStep2Title", {
                      _: "Añadir a pantalla de inicio",
                    })}
                  </p>
                  <p className="text-muted-foreground pt-0.5">
                    {translate("savia.pwa.iosStep2Desc", {
                      _: "Baja por la lista de opciones y pulsa 'Añadir a pantalla de inicio'.",
                    })}
                  </p>
                </div>
              </div>
            </>
          )}

          {platform === "mac-safari" && (
            <>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  1
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <Compass className="size-4 text-primary" />
                    {translate("savia.pwa.macSafariStep1Title", {
                      _: "Abre el menú Archivo",
                    })}
                  </p>
                  <p className="text-muted-foreground pt-0.5">
                    {translate("savia.pwa.macSafariStep1Desc", {
                      _: "En la barra superior de tu Mac con Safari activo, haz clic en el menú Archivo.",
                    })}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  2
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <PlusSquare className="size-4 text-primary" />
                    {translate("savia.pwa.macSafariStep2Title", {
                      _: "Selecciona 'Añadir al Dock…'",
                    })}
                  </p>
                  <p className="text-muted-foreground pt-0.5">
                    {translate("savia.pwa.macSafariStep2Desc", {
                      _: "Savia se instalará como aplicación nativa en tu Dock de macOS.",
                    })}
                  </p>
                </div>
              </div>
            </>
          )}

          {platform === "android" && (
            <>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  1
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {translate("savia.pwa.androidStep1Title", {
                      _: "Abre el menú de Chrome",
                    })}
                  </p>
                  <p className="text-muted-foreground pt-0.5">
                    {translate("savia.pwa.androidStep1Desc", {
                      _: "Toca el icono de tres puntos (⋮) en la esquina superior derecha del navegador.",
                    })}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  2
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {translate("savia.pwa.androidStep2Title", {
                      _: "Instalar aplicación",
                    })}
                  </p>
                  <p className="text-muted-foreground pt-0.5">
                    {translate("savia.pwa.androidStep2Desc", {
                      _: "Selecciona 'Instalar aplicación' o 'Añadir a la pantalla principal'.",
                    })}
                  </p>
                </div>
              </div>
            </>
          )}

          {(platform === "chromium" || platform === "other") && (
            <>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  1
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <Monitor className="size-4 text-primary" />
                    {translate("savia.pwa.desktopStep1Title", {
                      _: "Icono en la barra de direcciones",
                    })}
                  </p>
                  <p className="text-muted-foreground pt-0.5">
                    {translate("savia.pwa.desktopStep1Desc", {
                      _: "En Chrome o Edge, busca el icono de instalar (computador con flecha hacia abajo) a la derecha de la barra de direcciones.",
                    })}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  2
                </div>
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {translate("savia.pwa.desktopStep2Title", {
                      _: "O desde el menú del navegador",
                    })}
                  </p>
                  <p className="text-muted-foreground pt-0.5">
                    {translate("savia.pwa.desktopStep2Desc", {
                      _: "Haz clic en el menú (⋮) de la esquina superior derecha y selecciona 'Instalar Savia…'.",
                    })}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-center">
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            {translate("savia.pwa.gotIt", {
              _: "Entendido",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
