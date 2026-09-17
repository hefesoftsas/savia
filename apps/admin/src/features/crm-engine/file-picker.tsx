import { useId, useRef, useState } from "react";
import { FileUp, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type FilePickerProps = {
  accept: string[];
  disabled?: boolean;
  files: File[];
  inputId?: string;
  maxFiles: number;
  maxSize: number;
  onFilesChange(files: File[]): void;
  uploadedFiles?: File[];
  uploadingFile?: File;
};

function acceptedType(file: File, accepted: string[]) {
  return (
    !accepted.length ||
    accepted.some(
      (type) =>
        type === file.type ||
        (type.endsWith("/*") && file.type.startsWith(type.slice(0, -1))),
    )
  );
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("es-CO", {
    maximumFractionDigits: 1,
  })} MB`;
}

export function FilePicker({
  accept,
  disabled = false,
  files,
  inputId,
  maxFiles,
  maxSize,
  onFilesChange,
  uploadedFiles = [],
  uploadingFile,
}: FilePickerProps) {
  const generatedInputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const remaining = Math.max(0, maxFiles - files.length);
  const attachmentNoun = maxFiles === 1 ? "archivo" : "archivos";
  const actionTextId = `${generatedInputId}-action`;

  function addFiles(next: Iterable<File>) {
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of next) {
      if (!acceptedType(file, accept)) {
        rejected.push(`${file.name}: este tipo de archivo no está permitido.`);
      } else if (!file.size || file.size > maxSize) {
        rejected.push(
          `${file.name}: supera el tamaño máximo de ${formatBytes(maxSize)}.`,
        );
      } else if (accepted.length >= remaining) {
        rejected.push(`${file.name}: se alcanzó el máximo de archivos.`);
      } else {
        accepted.push(file);
      }
    }
    setError(rejected.join(" "));
    if (accepted.length) onFilesChange([...files, ...accepted]);
  }

  return (
    <div className="grid gap-3">
      <input
        ref={input}
        accept={accept.join(",") || undefined}
        aria-hidden="true"
        className="sr-only"
        data-testid="file-picker-input"
        disabled={disabled || remaining === 0}
        id={`${generatedInputId}-input`}
        multiple={maxFiles > 1}
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          if (event.currentTarget.files) addFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-left transition-colors hover:border-primary/60 hover:bg-muted/50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
        data-disabled={disabled || remaining === 0 || undefined}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!disabled && remaining) addFiles(event.dataTransfer.files);
        }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <FileUp aria-hidden="true" size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Adjunta {maxFiles === 1 ? "un archivo" : "archivos"}
          </p>
          <p className="text-xs text-muted-foreground">
            {maxFiles === 1
              ? "Arrastra el archivo o selecciónalo."
              : "Arrastra los archivos o selecciónalos."} Máximo {maxFiles} {attachmentNoun} · {" "}
            {formatBytes(maxSize)} por archivo
          </p>
        </div>
        <Button
          aria-labelledby={
            inputId ? `${inputId}_label ${actionTextId}` : undefined
          }
          className="col-span-2 justify-self-start sm:col-span-1 sm:justify-self-end"
          disabled={disabled || remaining === 0}
          id={inputId ?? generatedInputId}
          onClick={() => input.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          <Paperclip aria-hidden="true" size={16} />
          <span id={actionTextId}>Adjuntar {attachmentNoun}</span>
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="grid gap-2" aria-label="Archivos pendientes">
          {files.map((file, index) => {
            const uploading = file === uploadingFile;
            const uploaded = uploadedFiles.includes(file);
            return (
              <li
                className="grid min-w-0 gap-2 rounded-md border bg-background px-3 py-2"
                key={`${file.name}-${file.lastModified}-${index}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Paperclip aria-hidden="true" className="shrink-0 text-primary" size={16} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                  <Button
                    aria-label={`Quitar ${file.name}`}
                    disabled={disabled || uploading}
                    onClick={() =>
                      onFilesChange(files.filter((_, current) => current !== index))
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" size={16} />
                  </Button>
                </div>
                <div className="grid gap-1">
                  <p
                    aria-live={uploading ? "polite" : undefined}
                    className="text-xs text-muted-foreground"
                  >
                    {uploading
                      ? "Cargando archivo…"
                      : uploaded
                        ? "Archivo cargado"
                        : "Pendiente de subir"}
                  </p>
                  <div
                    aria-label={`Carga de ${file.name}`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={uploaded ? 100 : uploading ? undefined : 0}
                    aria-valuetext={
                      uploading
                        ? "Cargando archivo"
                        : uploaded
                          ? "Archivo cargado"
                          : "Pendiente de subir"
                    }
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                  >
                    <div
                      className={
                        uploaded
                          ? "h-full w-full rounded-full bg-primary"
                          : uploading
                            ? "h-full w-2/3 animate-pulse rounded-full bg-primary"
                            : "h-full w-0 rounded-full bg-primary"
                      }
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
