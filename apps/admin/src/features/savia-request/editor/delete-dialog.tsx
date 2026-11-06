import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DeleteAction = {
  title: string;
  description: string;
  run(): void | Promise<void>;
};

export function DeleteDialog({
  action,
  onClose,
}: {
  action: DeleteAction;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.title}</DialogTitle>
          <DialogDescription>{action.description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(action.run()).then(
                () => onClose(),
                (exception) => {
                  setError(
                    exception instanceof Error
                      ? exception.message
                      : "No se pudo completar la eliminación.",
                  );
                  setBusy(false);
                },
              );
            }}
            type="button"
            variant="destructive"
          >
            {busy ? "Eliminando…" : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
