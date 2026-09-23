import type { PluginApi, PluginFile } from "@savia/studio-shared/plugin-api";
import type { Receipt } from "@savia/insurance-communications/gateway";
import { requirement } from "./object";
import { renderDocument } from "./domain";
export type DocumentRecord = Record<string, unknown> & {
  id: string;
  _version?: number;
};
export async function persistDocument(
  savia: PluginApi,
  input: { name: string; body: string },
  existing?: DocumentRecord,
) {
  if (!savia.files)
    throw Error(
      "El almacenamiento de archivos no está disponible en este entorno.",
    );
  if (!input.name.trim() || !input.body.trim())
    throw Error("Completa el nombre y contenido del documento.");
  const collection = savia.collections.collection<DocumentRecord>(
    requirement.object.name,
  );
  const record =
    existing ??
    (await collection.create({
      name: input.name,
      template: input.body,
      kind: "document",
      stage: "draft",
    }));
  if (existing && (existing.kind !== "document" || existing.stage !== "draft"))
    throw new Error("Solo se puede reintentar un documento en borrador.");
  const artifact = await savia.files.upload(
    requirement.object.name,
    record.id,
    new File(
      [renderDocument(input.name, "{{body}}", { body: input.body })],
      "documento.html",
      { type: "text/html" },
    ),
  );
  return collection.update(
    record.id,
    {
      stage: "generated",
      artifact_file_id: artifact.id,
      artifact_file_version: artifact.version,
    },
    { version: record._version },
  );
}
export function signaturePatch(receipt: Receipt): Record<string, unknown> {
  let evidence = false;
  try {
    const url = new URL(receipt.evidenceUrl ?? "");
    evidence = url.protocol === "https:" && !url.username && !url.password;
  } catch {
    /* No verified link. */
  }
  const signed =
    receipt.state === "delivered" &&
    Boolean(receipt.signedAt) &&
    Number.isFinite(Date.parse(receipt.signedAt!)) &&
    evidence;
  return {
    stage: signed ? "signed" : "requested",
    signature_reference: receipt.reference,
    ...(signed
      ? { signed_at: receipt.signedAt, evidence_url: receipt.evidenceUrl }
      : {}),
  };
}

export async function resolveArtifact(
  savia: PluginApi,
  record: DocumentRecord,
): Promise<PluginFile> {
  if (
    !savia.files ||
    record.kind !== "document" ||
    typeof record.artifact_file_id !== "string" ||
    !Number.isInteger(record.artifact_file_version)
  )
    throw new Error(
      "El documento no tiene un archivo canónico confirmado. Genera un nuevo documento.",
    );
  const files = await savia.files.list(requirement.object.name, record.id);
  const file = files.find(
    (file) =>
      file.id === record.artifact_file_id &&
      file.version === record.artifact_file_version,
  );
  if (!file)
    throw new Error(
      "El archivo generado fue eliminado o cambió de versión. Genera un nuevo documento antes de solicitar firma.",
    );
  return file;
}
export function loadDocumentFiles(
  savia: PluginApi,
  id: string,
  receive: (files: PluginFile[]) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true;
  if (savia.files)
    void savia.files
      .list(requirement.object.name, id)
      .then((files) => {
        if (active) receive(files);
      })
      .catch((error) => {
        if (active) onError(error);
      });
  return () => {
    active = false;
  };
}
