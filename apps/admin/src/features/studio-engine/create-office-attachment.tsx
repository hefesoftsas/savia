import { useOfficeAvailability } from "@/features/office-settings/office-availability";
import { useId, useState } from "react";
import { FilePlus2 } from "lucide-react";
import type { OfficeFormat } from "@savia/studio-shared/office";
import { useMessages } from "@/i18n/core";
import { documentDeliveryMessages } from "@/i18n/locales/document-delivery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBlankOfficeFile } from "../office/new-office-file";
import { officeEditorUrl } from "../office/office-api";
import { getStudioRuntime } from "./runtime";

const formatsDefault: OfficeFormat[] = ["docx", "xlsx", "pptx"];
export function CreateOfficeAttachment({
  onCreate,
  disabled = false,
  formats = formatsDefault,
  maxSize = 5 * 1024 * 1024,
}: {
  onCreate(file: File): Promise<{ id: string } | void>;
  disabled?: boolean;
  formats?: OfficeFormat[];
  maxSize?: number;
}) {
  const office = useOfficeAvailability();
  const t = useMessages(documentDeliveryMessages);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<OfficeFormat>("docx");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string } | null>(null);
  const defaultName = (kind: OfficeFormat) =>
    t(
      kind === "docx"
        ? "Documento"
        : kind === "xlsx"
          ? "Hoja de cálculo"
          : "Presentación",
    );
  if (!office.enabled || !formats.length) return null;
  const editorUrl = created
    ? officeEditorUrl(getStudioRuntime().apiBasePath, created.id)
    : null;
  async function create() {
    if (busy || disabled || !formats.includes(format)) return;
    setBusy(true);
    setError("");
    try {
      const file = await createBlankOfficeFile(format, name);
      if (file.size > maxSize)
        throw new Error(
          t("El archivo supera el tamaño permitido para este campo."),
        );
      const saved = await onCreate(file);
      if (saved) setCreated(saved);
      else setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("No se pudo crear el archivo."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        aria-expanded={open}
        onClick={() => {
          const initial = formats[0];
          setFormat(initial);
          setName(defaultName(initial));
          setError("");
          setCreated(null);
          setOpen(true);
        }}
      >
        <FilePlus2 size={16} aria-hidden="true" />
        {t("Crear archivo")}
      </Button>
      {open && (
        <section
          aria-labelledby={id + "-title"}
          className="mt-3 grid min-w-0 gap-4 rounded-lg border bg-background p-4"
        >
          <header className="space-y-1">
            <h3 id={id + "-title"} className="text-sm font-semibold">
              {t("Crear archivo")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                created
                  ? "Archivo guardado en los adjuntos."
                  : "Crea un archivo en blanco en la suite de ofimática.",
              )}
            </p>
          </header>
          {!created && (
            <div className="grid min-w-0 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={id + "-type"}>{t("Tipo de archivo")}</Label>
                <select
                  id={id + "-type"}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={format}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.value as OfficeFormat;
                    if (name === defaultName(format))
                      setName(defaultName(next));
                    setFormat(next);
                  }}
                >
                  {formats.map((kind) => (
                    <option key={kind} value={kind}>
                      {defaultName(kind)} (.{kind})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={id + "-name"}>{t("Nombre del archivo")}</Label>
                <Input
                  id={id + "-name"}
                  value={name}
                  maxLength={180}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void create();
                    }
                  }}
                />
              </div>
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("Cerrar")}
            </Button>
            {created ? (
              editorUrl && (
                <Button asChild>
                  <a href={editorUrl} target="_blank" rel="noopener noreferrer">
                    {t("Abrir en la suite de ofimática")}
                  </a>
                </Button>
              )
            ) : (
              <Button
                type="button"
                disabled={busy || disabled || !name.trim()}
                onClick={() => void create()}
              >
                {t(busy ? "Creando archivo…" : "Crear y adjuntar")}
              </Button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
