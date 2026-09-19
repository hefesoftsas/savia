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

function Control({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
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
  const [html, setHtml] = useState(value.html);
  const [script, setScript] = useState(value.script ?? "");

  useEffect(() => {
    if (!open) return;
    setHtml(value.html);
    setScript(value.script ?? "");
  }, [open, value.html, value.script]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="form-html-editor-dialog">
        <DialogHeader>
          <DialogTitle>Editor HTML y JavaScript</DialogTitle>
        </DialogHeader>
        {open ? (
          <div className="form-html-editor-dialog-body">
            <Control label="HTML">
              <MonacoCodeEditor
                ariaLabel="Editor HTML"
                language="html"
                height={280}
                value={html}
                onChange={setHtml}
                placeholder={'<div><p>{{values.nombre}}</p></div>'}
              />
            </Control>
            <Control label="JavaScript (opcional)">
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave({
                html,
                script: script.trim() ? script : undefined,
              });
              onOpenChange(false);
            }}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
