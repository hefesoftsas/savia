import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useMessages, type MessageCatalog } from "@/i18n/core";
const messages = {
  Close: ["Cerrar", "Close", "Fechar"],
  "Discard changes?": [
    "¿Descartar los cambios?",
    "Discard changes?",
    "Descartar alterações?",
  ],
  "Your unsaved changes will be lost.": [
    "Se perderán los cambios sin guardar.",
    "Your unsaved changes will be lost.",
    "As alterações não salvas serão perdidas.",
  ],
  "Keep editing": ["Seguir editando", "Keep editing", "Continuar editando"],
  Discard: ["Descartar", "Discard", "Descartar"],
} satisfies MessageCatalog;
export function PluginHostPanel({
  title,
  open = true,
  retained = false,
  busy,
  confirming,
  onClose,
  onDiscard,
  onKeep,
  closeRef,
  onFocusEditor,
  children,
}: {
  title: string;
  open?: boolean;
  retained?: boolean;
  busy: boolean;
  confirming: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onKeep: () => void;
  closeRef: RefObject<HTMLButtonElement | null>;
  onFocusEditor: (backwards: boolean) => void;
  children: ReactNode;
}) {
  const t = useMessages(messages);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!retained || !open) return;
    const content = contentRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const siblings = Array.from(document.body.children).filter((el): el is HTMLElement =>
      el instanceof HTMLElement && !el.contains(content) && !el.hasAttribute("data-plugin-overlay"));
    const prior = siblings.map(el => ({ el, inert: el.inert }));
    for (const { el } of prior) el.inert = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const trap = (event: FocusEvent) => {
      if (!content?.contains(event.target as Node) && !confirming) closeRef.current?.focus();
    };
    document.addEventListener("focusin", trap);
    return () => {
      for (const { el, inert } of prior) el.inert = inert;
      document.body.style.overflow = overflow;
      document.removeEventListener("focusin", trap);
      previousFocus?.focus();
    };
  }, [retained, open, confirming, closeRef]);
  return (
    <Dialog.Root
      open={open}
      modal={!retained}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal forceMount={retained ? true : undefined}>
        {retained ? (open && <div data-plugin-overlay className="fixed inset-0 z-[150] bg-black/40" onClick={() => { if (!confirming) onClose(); }} />) : <Dialog.Overlay className="fixed inset-0 z-[150] bg-black/40" />}
        <Dialog.Content
          ref={contentRef}
          forceMount={retained ? true : undefined}
          hidden={!open}
          inert={!open}
          style={!open ? { display: "none" } : undefined}
          aria-modal={open ? true : undefined}
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-[151] flex h-dvh w-full max-w-[640px] flex-col bg-background text-foreground shadow-xl outline-none motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            if (!confirming) onClose();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            if (!confirming) onClose();
          }}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4">
            <Dialog.Title className="text-lg font-semibold">
              {title}
            </Dialog.Title>
            <Button
              ref={closeRef}
              variant="outline"
              className="min-h-11"
              aria-disabled={busy}
              onClick={onClose}
              onKeyDown={(event) => {
                if (event.key === "Tab" && !confirming) {
                  event.preventDefault();
                  onFocusEditor(event.shiftKey);
                }
              }}
            >
              {t("Close")}
            </Button>
          </header>
          <div className="relative min-h-0 flex-1">{children}</div>
          <Dialog.Root
            open={confirming}
            onOpenChange={(open) => {
              if (!open) onKeep();
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[152] bg-black/40" />
              <Dialog.Content
                className="fixed left-1/2 top-1/2 z-[153] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border bg-background p-6 shadow-xl"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  closeRef.current?.focus();
                }}
              >
                <Dialog.Title className="text-lg font-semibold">
                  {t("Discard changes?")}
                </Dialog.Title>
                <Dialog.Description>
                  {t("Your unsaved changes will be lost.")}
                </Dialog.Description>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={onKeep}>{t("Keep editing")}</Button>
                  <Button variant="outline" onClick={onDiscard}>
                    {t("Discard")}
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
