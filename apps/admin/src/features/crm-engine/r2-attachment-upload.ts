import type { AttachmentUploadStatus, PendingAttachment } from "./dynamic-form";
import { crmFetch } from "./api";

export type TemporaryR2Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  field: string;
  version: number;
  expiresAt: string;
};

export async function uploadTemporaryR2Attachment(
  object: string,
  field: string,
  file: File,
): Promise<TemporaryR2Attachment> {
  const body = new FormData();
  body.set("field", field);
  body.set("file", file);
  const response = await crmFetch(
    `/api/file-drafts/${encodeURIComponent(object)}`,
    { body, method: "POST" },
  );
  const result = (await response.json()) as {
    data?: TemporaryR2Attachment;
    error?: string;
  };
  if (!response.ok || !result.data)
    throw new Error(result.error ?? "No se pudo subir el archivo.");
  return result.data;
}

export async function attachTemporaryR2Attachments(
  recordId: string,
  attachments: TemporaryR2Attachment[],
) {
  for (const attachment of attachments) {
    const response = await crmFetch(
      `/api/file-drafts/${encodeURIComponent(attachment.id)}/attach`,
      {
        body: JSON.stringify({ recordId, version: attachment.version }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(result.error ?? "No se pudo asociar el archivo al registro.");
  }
}

export async function deleteTemporaryR2Attachments(
  attachments: TemporaryR2Attachment[],
) {
  await Promise.all(
    attachments.map(async (attachment) => {
      const response = await crmFetch(`/api/file/${encodeURIComponent(attachment.id)}`, {
        body: JSON.stringify({ version: attachment.version }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "No se pudo eliminar el archivo temporal.");
    }),
  );
}

export async function uploadR2Attachments(
  object: string,
  recordId: string,
  attachments: PendingAttachment[],
  onStatus: (status: AttachmentUploadStatus) => void = () => {},
) {
  for (const attachment of attachments) {
    for (const file of attachment.files) {
      onStatus({ field: attachment.field, file, status: "uploading" });
      const body = new FormData();
      body.set("field", attachment.field);
      body.set("file", file);
      const response = await crmFetch(
        `/api/files/${encodeURIComponent(object)}/${encodeURIComponent(recordId)}`,
        { body, method: "POST" },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "No se pudo subir el archivo a R2.");
      onStatus({ field: attachment.field, file, status: "uploaded" });
    }
  }
}
