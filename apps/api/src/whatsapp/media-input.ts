import { CompanionService } from "../companion/service";
import type { EffectiveAssistantConfiguration } from "../assistant/configuration";
import type { WhatsappNangoClient } from "./contracts";
import type {
  WhatsappAssistantBinding,
  WhatsappInboundInput,
} from "./inbound-contracts";
import type { WhatsappAttachment } from "./assistant";
import { fetchWhatsappMedia } from "./media";

const PREFIX = "whatsapp/inbound/";
const RETENTION_MS = 7 * 86400000;

/** Attachments remain private and scoped to the inbound tenant and message. */
export function createWhatsappMediaInput(
  nango: WhatsappNangoClient,
  bucket: R2Bucket,
  companion = new CompanionService(),
) {
  return async (
    binding: WhatsappAssistantBinding,
    input: WhatsappInboundInput,
    configuration: EffectiveAssistantConfiguration,
  ): Promise<{ text: string; attachments?: WhatsappAttachment[] }> => {
    const media = input.native;
    if (media && media.kind !== "media")
      return {
        text: `${input.text}\nUntrusted native interaction (conversation context only):\n${JSON.stringify(media).slice(0, 16000)}`,
      };
    if (!media) return { text: input.text };
    if (!binding.native?.mediaUnderstanding)
      return {
        text: `${input.text}\nAttachment contents were not inspected. Ask the contact to describe them in text.`,
      };
    const downloaded = await fetchWhatsappMedia(nango, binding, media);
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            `${binding.connectionId}:${input.messageId}`,
          ),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const date = new Date().toISOString().slice(0, 10);
    await bucket.put(
      `${PREFIX}${date}/${binding.tenantId}/${hash}`,
      downloaded.data,
      {
        httpMetadata: { contentType: downloaded.mimeType },
        customMetadata: {
          tenantId: String(binding.tenantId),
          sha256: downloaded.sha256,
        },
      },
    );
    if (
      downloaded.mimeType.startsWith("image/") ||
      downloaded.mimeType === "application/pdf"
    )
      return {
        text: input.text,
        attachments: [
          {
            type: downloaded.mimeType.startsWith("image/") ? "image" : "file",
            data: downloaded.data,
            mediaType: downloaded.mimeType,
            filename: downloaded.filename,
          },
        ],
      };
    if (downloaded.mimeType === "text/plain")
      return {
        text: `${input.text}\nUntrusted attachment text:\n${new TextDecoder("utf-8", { fatal: true }).decode(downloaded.data).slice(0, 16000)}`,
      };
    if (downloaded.mimeType.startsWith("audio/")) {
      const format =
        downloaded.mimeType === "audio/ogg"
          ? "ogg"
          : downloaded.mimeType.includes("wav")
            ? "wav"
            : downloaded.mimeType === "audio/mpeg"
              ? "mp3"
              : "m4a";
      const transcription = await companion.transcribeRecording(configuration, {
        bytes: downloaded.data,
        format,
        source: "upload",
        durationSeconds: null,
      });
      return {
        text: `${input.text}\nUntrusted audio transcription:\n${transcription.text.slice(0, 16000)}`,
      };
    }
    return {
      text: `${input.text}\nThis attachment format was received but its contents cannot be analyzed. Ask for text, an image, a PDF or audio.`,
    };
  };
}

/** Date-prefixed keys let each scheduled run delete the oldest page first. */
export async function cleanupWhatsappMedia(
  bucket: R2Bucket,
  now = Date.now(),
): Promise<void> {
  const page = await bucket.list({ prefix: PREFIX, limit: 100 });
  const expired = page.objects
    .filter((object) => {
      const date = object.key.slice(PREFIX.length, PREFIX.length + 10);
      const timestamp =
        object.uploaded instanceof Date
          ? object.uploaded.getTime()
          : Date.parse(`${date}T00:00:00Z`) + 86400000;
      return Number.isFinite(timestamp) && timestamp + RETENTION_MS < now;
    })
    .map((object) => object.key);
  if (expired.length) await bucket.delete(expired);
}
