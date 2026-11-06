import { z } from "zod";
import type { InstalledEditorExtension } from "@savia/studio-shared/plugin-editor-extensions";
import type { EditorSession } from "./plugin-editor-session";

const beginSchema = z.object({
  type: z.literal("begin"),
  id: z.string().max(80),
  installationId: z.string().max(80),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
const chunkSchema = z.object({
  type: z.literal("chunk"),
  id: z.string().max(80),
  offset: z.number().int().nonnegative(),
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.length > 0 && bytes.length <= 64 * 1024),
});
const endSchema = z.object({ type: z.literal("end"), id: z.string().max(80) });
const messageSchema = z.discriminatedUnion("type", [
  beginSchema,
  chunkSchema,
  endSchema,
]);
export class EditorExtensionTransferReceiver {
  private current?: {
    id: string;
    installationId: string;
    sha256: string;
    bytes: Uint8Array;
    offset: number;
    started: number;
  };
  private timer?: ReturnType<typeof setTimeout>;
  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.current = undefined;
  }
  accept(
    input: unknown,
  ): { installationId: string; sha256: string; bytes: Uint8Array } | null {
    const message = messageSchema.parse(input);
    if (message.type === "begin") {
      this.clear();
      this.timer = setTimeout(() => this.clear(), 60000);
      this.current = {
        ...message,
        bytes: new Uint8Array(message.size),
        offset: 0,
        started: Date.now(),
      };
      return null;
    }
    const current = this.current;
    if (
      !current ||
      message.id !== current.id ||
      Date.now() - current.started > 60000
    ) {
      this.clear();
      throw new Error(
        "Extension transfer expired or belongs to another session.",
      );
    }
    if (message.type === "chunk") {
      if (
        message.offset !== current.offset ||
        current.offset + message.bytes.length > current.bytes.length
      ) {
        this.clear();
        throw new Error("Invalid extension transfer chunk.");
      }
      current.bytes.set(message.bytes, current.offset);
      current.offset += message.bytes.length;
      return null;
    }
    this.clear();
    if (current.offset !== current.bytes.length)
      throw new Error("Incomplete extension transfer.");
    return {
      installationId: current.installationId,
      sha256: current.sha256,
      bytes: current.bytes,
    };
  }
}

export async function transferEditorExtension(
  session: EditorSession,
  installation: InstalledEditorExtension,
  bytes: Uint8Array,
  send: (message: unknown) => Promise<void>,
): Promise<void> {
  if (
    bytes.length !== installation.compressedBytes ||
    bytes.length > 20 * 1024 * 1024
  )
    throw new Error("Invalid extension package size.");
  const id = crypto.randomUUID();
  const transmit = (payload: unknown) =>
    send({ session, message: { type: "savia-editor-package", payload } });
  await transmit({
    type: "begin",
    id,
    installationId: installation.installationId,
    sha256: installation.sha256,
    size: bytes.length,
  });
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024)
    await transmit({
      type: "chunk",
      id,
      offset,
      bytes: bytes.slice(offset, offset + 64 * 1024),
    });
  await transmit({ type: "end", id });
}
