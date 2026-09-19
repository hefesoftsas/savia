import { Share, PlusSquare } from "lucide-react";
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

export type PwaInstallDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PwaInstallDialog({ open, onOpenChange }: PwaInstallDialogProps) {
  const translate = useTranslate();

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <PlusSquare className="size-6" />
          </div>
          <DialogTitle className="text-center text-xl">
            {translate("savia.pwa.iosTitle", {
              _: "Instalar Savia en tu dispositivo",
            })}
          </DialogTitle>
          <DialogDescription className="text-center">
            {translate("savia.pwa.iosSubtitle", {
              _: "Instala Savia como aplicación para acceder rápidamente desde tu pantalla de inicio y utilizarla a pantalla completa.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
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
                  _: "Baja por la lista de opciones y pulsa 'Añadir a pantalla de inicio' (Add to Home Screen).",
                })}
              </p>
            </div>
          </div>
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
