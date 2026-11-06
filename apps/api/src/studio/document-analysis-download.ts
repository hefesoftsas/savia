import { isPublicAddress } from "@savia/studio-server/integrations";
import { assertStoreHttpUrl } from "@savia/studio-shared/plugin-store";

export const MAX_REMOTE_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_CHALLENGE_BYTES = 32 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export class RemoteDocumentDownloadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "RemoteDocumentDownloadError";
  }
}

function fail(code = "DOCUMENT_DOWNLOAD_FAILED", status = 422): never {
  throw new RemoteDocumentDownloadError(
    code === "DOCUMENT_TOO_LARGE"
      ? "Document files must be 5 MB or smaller."
      : code === "INVALID_DOCUMENT"
        ? "The remote file is not a valid PDF, DOCX or XLSX document."
        : code === "DOCUMENT_ACCESS_CHALLENGE"
          ? "The document source requires an access check. Open the source in a browser and try again."
          : "The document could not be downloaded from that source.",
    status,
    code,
  );
}

function supportedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".xlsx")
  );
}

function assertSupportedSignature(bytes: Uint8Array, filename: string): void {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    if (!new TextDecoder().decode(bytes.subarray(0, 5)).startsWith("%PDF-"))
      throw new RemoteDocumentDownloadError(
        "The remote file is not a valid PDF, DOCX or XLSX document.",
        415,
        "INVALID_DOCUMENT",
      );
    return;
  }
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  )
    throw new RemoteDocumentDownloadError(
      "The remote file is not a valid PDF, DOCX or XLSX document.",
      415,
      "INVALID_DOCUMENT",
    );
}

function allowedHttpsUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = assertStoreHttpUrl(raw, allowedHosts);
  } catch (error) {
    if (error instanceof RemoteDocumentDownloadError) throw error;
    return fail();
  }
  if (url.username || url.password || url.hash) return fail();
  return url;
}

async function verifyPublicDns(
  url: URL,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  try {
    const records = await Promise.all(
      ["A", "AAAA"].map(async (type) => {
        const endpoint = new URL("https://cloudflare-dns.com/dns-query");
        endpoint.searchParams.set("name", url.hostname);
        endpoint.searchParams.set("type", type);
        const response = await fetcher(endpoint, {
          headers: { Accept: "application/dns-json" },
          redirect: "manual",
          signal,
        });
        if (!response.ok || response.redirected) return fail();
        const body = (await response.json()) as {
          Status?: unknown;
          Answer?: unknown;
        };
        if (
          body.Status !== 0 ||
          (body.Answer !== undefined && !Array.isArray(body.Answer))
        )
          return fail();
        return (body.Answer ?? []).flatMap((record: unknown) => {
          if (!record || typeof record !== "object") return [];
          const answer = record as { type?: unknown; data?: unknown };
          return [1, 28].includes(Number(answer.type)) ? [answer.data] : [];
        });
      }),
    );
    const addresses = records.flat();
    if (
      !addresses.length ||
      addresses.some(
        (address) => typeof address !== "string" || !isPublicAddress(address),
      )
    )
      return fail();
  } catch (error) {
    if (error instanceof RemoteDocumentDownloadError) throw error;
    return fail();
  }
}

async function readChallengeText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_CHALLENGE_BYTES - size;
      chunks.push(value.subarray(0, remaining));
      size += Math.min(value.byteLength, remaining);
      if (size >= MAX_CHALLENGE_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes).toLowerCase();
}

function looksLikeAccessChallenge(value: string): boolean {
  return /captcha|cf-chl-|challenge-platform|verify you are human|checking your browser|attention required|robot check|security check|forbidden|access denied|request blocked/.test(
    value,
  );
}

async function readDocument(
  response: Response,
  signal: AbortSignal,
  filename: string,
): Promise<Uint8Array> {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_REMOTE_DOCUMENT_BYTES
  ) {
    void response.body?.cancel().catch(() => {});
    return fail("DOCUMENT_TOO_LARGE", 413);
  }
  const reader = response.body?.getReader();
  if (!reader) return fail("INVALID_DOCUMENT");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) return fail();
      const result = await reader.read();
      if (signal.aborted) return fail();
      const { done, value } = result;
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REMOTE_DOCUMENT_BYTES) {
        await reader.cancel().catch(() => {});
        return fail("DOCUMENT_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RemoteDocumentDownloadError) throw error;
    return fail();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    assertSupportedSignature(bytes, filename);
  } catch (error) {
    if (
      looksLikeAccessChallenge(
        new TextDecoder()
          .decode(bytes.subarray(0, MAX_CHALLENGE_BYTES))
          .toLowerCase(),
      )
    )
      return fail("DOCUMENT_ACCESS_CHALLENGE");
    throw error;
  }
  if (signal.aborted) return fail();
  return bytes;
}

export async function downloadRemotePdf(
  downloadUrl: string,
  filename: string,
  fetcher: typeof fetch,
  allowedHosts: readonly string[],
): Promise<{ filename: string; content: Uint8Array; base64: string }> {
  if (!supportedExtension(filename)) return fail("INVALID_DOCUMENT", 415);
  if (!allowedHosts.length) return fail();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const signal = controller.signal;
  try {
    let destination = allowedHttpsUrl(downloadUrl, allowedHosts);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      await verifyPublicDns(destination, fetcher, signal);
      try {
        response = await fetcher(destination, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          signal,
          headers: {
            Accept:
              "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.8",
          },
        });
      } catch {
        return fail();
      }
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        if (redirects === MAX_REDIRECTS) return fail();
        const location = response.headers.get("location");
        if (!location) return fail();
        try {
          destination = allowedHttpsUrl(
            new URL(location, destination).href,
            allowedHosts,
          );
        } catch {
          return fail();
        }
        continue;
      }
      break;
    }
    if (!response) return fail();
    if (!response.ok) {
      const body = await readChallengeText(response, signal);
      if (
        (response.status === 403 || response.status === 429) &&
        looksLikeAccessChallenge(body)
      )
        return fail("DOCUMENT_ACCESS_CHALLENGE");
      return fail();
    }
    const contentType = (
      response.headers.get("content-type") ?? ""
    ).toLowerCase();
    if (contentType.includes("text/html")) {
      const body = await readChallengeText(response, signal);
      if (looksLikeAccessChallenge(body))
        return fail("DOCUMENT_ACCESS_CHALLENGE");
      return fail("INVALID_DOCUMENT", 415);
    }
    const content = await readDocument(response, signal, filename);
    let binary = "";
    for (let offset = 0; offset < content.length; offset += 0x7ffe)
      binary += String.fromCharCode(
        ...content.subarray(offset, offset + 0x7ffe),
      );
    return { filename, content, base64: btoa(binary) };
  } catch (error) {
    if (error instanceof RemoteDocumentDownloadError) throw error;
    return fail();
  } finally {
    clearTimeout(timer);
  }
}
