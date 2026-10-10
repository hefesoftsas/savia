import { PLUGIN_PROJECT_MAX_BYTES } from "@savia/studio-shared/plugin-projects";
import { fail } from "./context";

// Leave room for the other columns within D1's 2 MB row limit.
const MAX_STORED_BYTES = 1_800_000;
// JSON escaping can expand each validated file character by up to six bytes.
const MAX_JSON_BYTES = PLUGIN_PROJECT_MAX_BYTES * 6;
const FORMAT = "savia.plugin-files.gzip.v1";
const encoder = new TextEncoder();

export async function encodePluginFilesJson(json: string): Promise<string> {
  const bytes = encoder.encode(json);
  if (bytes.length > MAX_JSON_BYTES)
    return fail("Plugin source exceeds the storage limit.", 413);
  if (bytes.length <= MAX_STORED_BYTES) return json;
  const compressed = new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  let binary = "";
  for (let offset = 0; offset < compressed.length; offset += 8192)
    binary += String.fromCharCode(
      ...compressed.subarray(offset, offset + 8192),
    );
  const stored = JSON.stringify({ format: FORMAT, data: btoa(binary) });
  if (encoder.encode(stored).length > MAX_STORED_BYTES)
    return fail(
      "Plugin source exceeds the storage limit after compression.",
      413,
    );
  return stored;
}

export async function decodePluginFilesJson(stored: string): Promise<string> {
  const envelope: unknown = JSON.parse(stored);
  if (
    !envelope ||
    typeof envelope !== "object" ||
    !("format" in envelope) ||
    envelope.format !== FORMAT
  )
    return stored;
  if (!("data" in envelope) || typeof envelope.data !== "string")
    throw new Error("Invalid compressed plugin source.");
  const bytes = Uint8Array.from(atob(envelope.data), (value) =>
    value.charCodeAt(0),
  );
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new Error("Expanded plugin source exceeds the storage limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const decoded = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
}
