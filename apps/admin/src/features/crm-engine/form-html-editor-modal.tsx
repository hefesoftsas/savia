import { LocalizedContentEditor } from "./localized-content-editor";
import { useMessages } from "@/i18n/core";
import { recordsMessages } from "@/i18n/locales/records";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FormHtmlConfig } from "@savia/crm-shared/form-html";
import { MonacoCodeEditor } from "./monaco-code-editor";

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="studio-control form-html-editor-control">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function FormHtmlEditorModal({
  open,
  onOpenChange,
  value,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: FormHtmlConfig;
  onSave: (next: FormHtmlConfig) => void;
}) {
  const t = useMessages(recordsMessages);

  const [translations, setTranslations] = useState(value.translations);
  const [html, setHtml] = useState(value.html);
  const [script, setScript] = useState(value.script ?? "");

  useEffect(() => {
    if (!open) return;
    setHtml(value.html);
    setTranslations(value.translations);
    setScript(value.script ?? "");
  }, [open, value.html, value.script, value.translations]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="form-html-editor-dialog">
        <DialogHeader>
          <DialogTitle>{t("Editor HTML y JavaScript")}</DialogTitle>
        </DialogHeader>
        {open ? (
          <div className="form-html-editor-dialog-body">
            <Control label={t("HTML")}>
              <MonacoCodeEditor
                ariaLabel="Editor HTML"
                language="html"
                height={280}
                value={html}
                onChange={setHtml}
                placeholder={"<div><p>{{values.nombre}}</p></div>"}
              />
            </Control>
            <LocalizedContentEditor
              value={translations}
              onChange={setTranslations}
            />
            <Control label={t("JavaScript (opcional)")}>
              <MonacoCodeEditor
                ariaLabel="Editor JavaScript"
                language="javascript"
                height={220}
                value={script}
                onChange={setScript}
                placeholder={
                  "container.querySelector('[data-savia-set-value]')?.addEventListener('click', () => setValue('nombre', 'Ejemplo'))"
                }
              />
            </Control>
          </div>
        ) : null}
        <DialogFooter className="form-html-editor-dialog-footer">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("Cancelar")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave({
                html,
                translations,
                script: script.trim() ? script : undefined,
              });
              onOpenChange(false);
            }}
          >
            {t("Guardar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
