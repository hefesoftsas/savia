import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { R2AttachmentPolicy } from "@savia/crm-shared/metadata";
import { crmFetch, downloadCrm } from "./api";
import { FilePicker } from "./file-picker";

export type CrmFileAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  field: string;
  version: number;
  created_at: string;
};

export type R2AttachmentFieldProps = {
  field: string;
  inputId?: string;
  object: string;
  onPendingChange(files: File[]): void;
  pending: File[];
  policy: R2AttachmentPolicy;
  refreshVersion?: number;
  recordId?: string;
  disabled?: boolean;
  uploadedFiles?: File[];
  uploadingFile?: File;
};

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("es-CO", {
    maximumFractionDigits: 1,
  })} MB`;
}

async function filesFor(object: string, recordId: string, field: string) {
  const response = await crmFetch(
    `/api/files/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}?field=${encodeURIComponent(field)}`,
  );
  const body = (await response.json()) as {
    data?: CrmFileAttachment[];
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? "No se pudieron cargar los archivos.");
  return body.data ?? [];
}

export function R2AttachmentField({
  disabled = false,
  field,
  inputId,
  object,
  onPendingChange,
  pending,
  policy,
  refreshVersion = 0,
  recordId,
  uploadedFiles,
  uploadingFile,
}: R2AttachmentFieldProps) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const query = useQuery({
    enabled: Boolean(recordId),
    queryKey: ["r2-attachments", object, recordId, field, refreshVersion],
    queryFn: () => filesFor(object, recordId!, field),
  });
  const persisted = query.data ?? [];
  const remaining = Math.max(0, policy.maxFiles - persisted.length);

  async function remove(file: CrmFileAttachment) {
    setError("");
    const response = await crmFetch(`/api/file/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: file.version }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "No se pudo eliminar el archivo.");
      return;
    }
    await client.invalidateQueries({
      queryKey: ["r2-attachments", object, recordId, field],
    });
  }

  return (
    <div className="grid gap-3">
      {recordId && query.isFetching && (
        <p className="text-sm text-muted-foreground">Cargando archivos…</p>
      )}
      {query.error && (
        <p className="text-sm text-destructive" role="alert">
          {query.error.message}
        </p>
      )}
      {persisted.length > 0 && (
        <ul className="grid gap-2" aria-label="Archivos guardados">
          {persisted.map((file) => (
            <li
              className="flex min-w-0 items-center gap-3 rounded-md border bg-background px-3 py-2"
              key={file.id}
            >
              <Paperclip aria-hidden="true" className="shrink-0 text-primary" size={16} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {file.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <Button
                aria-label={`Descargar ${file.name}`}
                onClick={() =>
                  void downloadCrm(`/api/file/${file.id}/download`, file.name).catch(
                    (cause: Error) => setError(cause.message),
                  )
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <Download aria-hidden="true" size={16} />
              </Button>
              <Button
                aria-label={`Eliminar ${file.name}`}
                disabled={disabled}
                onClick={() => void remove(file)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!recordId && (
        <p className="text-sm text-muted-foreground">
          El archivo se cargará ahora y se asociará al guardar el registro.
        </p>
      )}
      <FilePicker
        accept={policy.accept}
        disabled={disabled || Boolean(uploadingFile) || remaining === 0}
        files={pending}
        inputId={inputId}
        maxFiles={Math.min(remaining, policy.maxFiles)}
        maxSize={policy.maxSize}
        onFilesChange={onPendingChange}
        uploadedFiles={uploadedFiles}
        uploadingFile={uploadingFile}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
