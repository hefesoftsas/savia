import type { WhatsappNangoClient } from "./contracts";
import type { WhatsappAssistantBinding } from "./inbound-contracts";
import type { NativeInbound } from "./native-input";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 15_000;
const GRAPH_VERSION = "v21.0";
const ATTACHMENT_ORIGIN = "https://lookaside.fbsbx.com";
const ATTACHMENT_HOST = "lookaside.fbsbx.com";
const HEX_SHA256 = /^[a-f\d]{64}$/i;
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

type MediaInput = Extract<NativeInbound, { kind: "media" }>;

type MediaMetadata = {
  url: string;
  file_size: number;
  mime_type: string;
  sha256: string;
  filename?: string;
};

function senderPhoneNumberId(binding: WhatsappAssistantBinding): string {
  const id = binding.connection.phoneNumberId;
  if (!id || !/^\d{5,20}$/.test(id))
    throw new Error("WHATSAPP_SENDER_UNAVAILABLE");
  return id;
}

function normalizeMime(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function supportedMime(value: string): string | undefined {
  const mimeType = normalizeMime(value);
  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "video/mp4",
    "text/plain",
  ].includes(mimeType)
    ? mimeType
    : undefined;
}

function hasSignature(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  const starts = (signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  switch (mimeType) {
    case "image/jpeg":
      return (
        bytes.length >= 4 &&
        starts([0xff, 0xd8, 0xff]) &&
        bytes[bytes.length - 2] === 0xff &&
        bytes[bytes.length - 1] === 0xd9
      );
    case "image/png":
      return bytes.length >= 24 && starts([137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/webp":
      return (
        bytes.length >= 16 &&
        ascii(0, 4) === "RIFF" &&
        ascii(8, 4) === "WEBP" &&
        ["VP8 ", "VP8L", "VP8X"].includes(ascii(12, 4))
      );
    case "application/pdf":
      return bytes.length >= 5 && ascii(0, 5) === "%PDF-";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return bytes.length >= 4 && starts([0x50, 0x4b, 0x03, 0x04]);
    case "audio/ogg":
      return bytes.length >= 4 && ascii(0, 4) === "OggS";
    case "audio/wav":
    case "audio/x-wav":
      return (
        bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE"
      );
    case "audio/mpeg":
      return (
        bytes.length >= 3 &&
        (ascii(0, 3) === "ID3" ||
          (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
      );
    case "audio/mp4":
    case "video/mp4":
      return bytes.length >= 12 && ascii(4, 4) === "ftyp";
    case "text/plain":
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function safeAttachmentPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith(`${ATTACHMENT_ORIGIN}/`))
    throw new Error("WHATSAPP_MEDIA_URL_INVALID");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WHATSAPP_MEDIA_URL_INVALID");
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new Error("WHATSAPP_MEDIA_URL_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== ATTACHMENT_HOST ||
    url.origin !== ATTACHMENT_ORIGIN ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !decodedPath.startsWith("/whatsapp_business/attachments/") ||
    decodedPath.includes("\\") ||
    decodedPath.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("WHATSAPP_MEDIA_URL_INVALID");
  return `${url.pathname}${url.search}`;
}

function decodeSha256(value: string): Uint8Array | undefined {
  try {
    if (HEX_SHA256.test(value))
      return Uint8Array.from({ length: 32 }, (_, index) =>
        Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
      );
    if (BASE64_SHA256.test(value))
      return Uint8Array.from(atob(value), (character) =>
        character.charCodeAt(0),
      );
  } catch {
    return undefined;
  }
  return undefined;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left[index] ^ right[index];
  return difference === 0;
}

function safeFilename(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const lastSegment = value.replace(/\\/g, "/").split("/").pop() ?? "";
  const sanitized = lastSegment.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return sanitized ? sanitized.slice(0, 255) : undefined;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_MEDIA_BYTES
  )
    throw new Error("WHATSAPP_MEDIA_TOO_LARGE");
  if (!response.body) throw new Error("WHATSAPP_MEDIA_DOWNLOAD_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
      reject(new Error("WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT"));
    }, MEDIA_DOWNLOAD_TIMEOUT_MS);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MEDIA_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("WHATSAPP_MEDIA_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      ["WHATSAPP_MEDIA_TOO_LARGE", "WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT"].includes(
        error.message,
      )
    )
      throw error;
    throw new Error("WHATSAPP_MEDIA_DOWNLOAD_FAILED");
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (timedOut) void reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // A cancelled read can remain unsettled on provider stream errors.
    }
  }
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) !== size
  )
    throw new Error("WHATSAPP_MEDIA_SIZE_MISMATCH");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function parseMetadata(value: unknown): MediaMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("WHATSAPP_MEDIA_METADATA_INVALID");
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.url !== "string" ||
    typeof metadata.mime_type !== "string" ||
    typeof metadata.sha256 !== "string" ||
    typeof metadata.file_size !== "number" ||
    !Number.isSafeInteger(metadata.file_size) ||
    metadata.file_size < 1 ||
    metadata.file_size > MAX_MEDIA_BYTES
  )
    throw new Error("WHATSAPP_MEDIA_METADATA_INVALID");
  return {
    url: metadata.url,
    mime_type: metadata.mime_type,
    sha256: metadata.sha256,
    file_size: metadata.file_size,
    ...(typeof metadata.filename === "string"
      ? { filename: metadata.filename }
      : {}),
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ownedBuffer = bytes.slice().buffer as ArrayBuffer;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", ownedBuffer),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function fetchWhatsappMedia(
  nango: Pick<WhatsappNangoClient, "proxy">,
  binding: WhatsappAssistantBinding,
  media: MediaInput,
): Promise<{
  data: Uint8Array;
  mimeType: string;
  filename?: string;
  sha256: string;
}> {
  if (!/^\d{5,32}$/.test(media.mediaId))
    throw new Error("WHATSAPP_MEDIA_ID_INVALID");
  const phoneNumberId = senderPhoneNumberId(binding);
  const metadataResponse = await nango.proxy({
    connection: binding.connection,
    method: "GET",
    path: `/${GRAPH_VERSION}/${media.mediaId}?phone_number_id=${phoneNumberId}`,
  });
  if (!metadataResponse.ok || metadataResponse.status >= 300)
    throw new Error("WHATSAPP_MEDIA_METADATA_FAILED");
  const metadata = parseMetadata(
    await metadataResponse.json().catch(() => undefined),
  );
  const urlPath = safeAttachmentPath(metadata.url);
  const mimeType = supportedMime(metadata.mime_type);
  if (!mimeType) throw new Error("WHATSAPP_MEDIA_MIME_UNSUPPORTED");
  if (media.mimeType.trim() && normalizeMime(media.mimeType) !== mimeType)
    throw new Error("WHATSAPP_MEDIA_MIME_MISMATCH");
  const expectedMetadataHash = decodeSha256(metadata.sha256);
  const expectedInboundHash = media.sha256
    ? decodeSha256(media.sha256)
    : undefined;
  if (!expectedMetadataHash || (media.sha256 && !expectedInboundHash))
    throw new Error("WHATSAPP_MEDIA_CHECKSUM_INVALID");

  const downloadResponse = await nango.proxy({
    connection: binding.connection,
    method: "GET",
    baseUrl: ATTACHMENT_ORIGIN,
    path: urlPath,
  });
  if (
    !downloadResponse.ok ||
    downloadResponse.status >= 300 ||
    downloadResponse.redirected
  )
    throw new Error("WHATSAPP_MEDIA_DOWNLOAD_FAILED");
  const responseMimeType = supportedMime(
    downloadResponse.headers.get("content-type") ?? "",
  );
  if (responseMimeType !== mimeType)
    throw new Error("WHATSAPP_MEDIA_MIME_MISMATCH");

  const data = await readBoundedBody(downloadResponse);
  if (data.byteLength !== metadata.file_size)
    throw new Error("WHATSAPP_MEDIA_SIZE_MISMATCH");
  if (!hasSignature(data, mimeType))
    throw new Error("WHATSAPP_MEDIA_SIGNATURE_INVALID");
  const ownedBuffer = data.slice().buffer as ArrayBuffer;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", ownedBuffer),
  );
  if (
    !equalBytes(digest, expectedMetadataHash) ||
    (expectedInboundHash && !equalBytes(digest, expectedInboundHash))
  )
    throw new Error("WHATSAPP_MEDIA_CHECKSUM_MISMATCH");
  return {
    data,
    mimeType,
    ...((safeFilename(metadata.filename) ?? safeFilename(media.filename))
      ? {
          filename:
            safeFilename(metadata.filename) ?? safeFilename(media.filename),
        }
      : {}),
    sha256: await sha256Hex(data),
  };
}

export async function uploadWhatsappMedia(
  nango: Pick<WhatsappNangoClient, "proxy">,
  binding: WhatsappAssistantBinding,
  data: Uint8Array,
  mimeTypeInput: string,
  filenameInput: string,
): Promise<string> {
  const phoneNumberId = senderPhoneNumberId(binding);
  const mimeType = supportedMime(mimeTypeInput);
  if (
    !data.byteLength ||
    data.byteLength > MAX_MEDIA_BYTES ||
    !mimeType ||
    !hasSignature(data, mimeType)
  )
    throw new Error("WHATSAPP_MEDIA_UPLOAD_INVALID");
  const filename = safeFilename(filenameInput);
  if (!filename) throw new Error("WHATSAPP_MEDIA_FILENAME_INVALID");
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mimeType);
  form.set(
    "file",
    new Blob([data.slice().buffer as ArrayBuffer], { type: mimeType }),
    filename,
  );
  const response = await nango.proxy({
    connection: binding.connection,
    method: "POST",
    path: `/${GRAPH_VERSION}/${phoneNumberId}/media`,
    body: form,
  });
  if (!response.ok) throw new Error("WHATSAPP_MEDIA_UPLOAD_FAILED");
  const payload = (await response.json().catch(() => undefined)) as
    { id?: unknown } | undefined;
  if (typeof payload?.id !== "string" || !/^\d{5,32}$/.test(payload.id))
    throw new Error("WHATSAPP_MEDIA_UPLOAD_UNCERTAIN");
  return payload.id;
}
