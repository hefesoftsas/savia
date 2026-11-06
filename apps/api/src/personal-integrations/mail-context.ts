import {
  mailContextReferenceSchema,
  type MailContextReference,
} from "@savia/studio-shared/mail-contracts";
import { HTTPException } from "hono/http-exception";

function denied(): never {
  throw new HTTPException(403, {
    message: "The selected mail context is no longer accessible",
  });
}
export async function validateMailContext(
  context: MailContextReference[],
  read: (path: string) => Promise<Response>,
): Promise<void> {
  for (const raw of context) {
    const reference = mailContextReferenceSchema.parse(raw);
    const metadata = await read(`${reference.apiBasePath}/api/objects`);
    if (!metadata.ok) denied();
    const payload = (await metadata.json().catch(() => null)) as {
      data?: { name?: string; config?: { fields?: Record<string, unknown> } }[];
    } | null;
    const collection = Array.isArray(payload?.data)
      ? payload.data.find((row) => row.name === reference.collection)
      : undefined;
    if (
      !collection?.config?.fields ||
      !reference.fields.every((field) =>
        Object.hasOwn(collection.config!.fields!, field),
      )
    )
      denied();
    const response = await read(
      `${reference.apiBasePath}/api/records/${encodeURIComponent(reference.collection)}/${encodeURIComponent(reference.recordId)}`,
    );
    if (response.status === 404)
      throw new HTTPException(404, {
        message: "The selected mail context record no longer exists",
      });
    if (!response.ok) denied();
    const record = (await response.json().catch(() => null)) as {
      data?: Record<string, unknown>;
    } | null;
    if (
      !record?.data ||
      String(record.data.id) !== reference.recordId ||
      !reference.fields.every((field) => Object.hasOwn(record.data!, field))
    )
      denied();
  }
}
