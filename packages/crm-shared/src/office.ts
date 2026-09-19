export const OFFICE_MAX_SIZE = 5 * 1024 * 1024;
export const OFFICE_FORMATS = {
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    part: "word/document.xml",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    part: "xl/workbook.xml",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    part: "ppt/presentation.xml",
  },
} as const;
export type OfficeFormat = keyof typeof OFFICE_FORMATS;
export function officeFormat(name: string, mime?: string): OfficeFormat | null {
  const ext = name.split(".").pop()?.toLowerCase() as OfficeFormat;
  const format = OFFICE_FORMATS[ext];
  return format &&
    (!mime || mime === "application/octet-stream" || mime === format.mime)
    ? ext
    : null;
}
/** Validate headers, then stream each entry without retaining decompressed content.
 * Both advertised and actual expansion are bounded before the Office engine opens it. */
export async function validateOfficePackage(
  bytes: Uint8Array,
  format: OfficeFormat,
): Promise<void> {
  const bad = () => {
    throw new Error(
      "El archivo Office está dañado o contiene elementos no admitidos.",
    );
  };
  if (bytes.byteLength < 22 || bytes.byteLength > OFFICE_MAX_SIZE) return bad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) return bad();
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true),
    inflated = 0;
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count !== view.getUint16(end + 8, true) ||
    !count ||
    count > 10000 ||
    offset + size !== end
  )
    return bad();
  const directoryStart = offset;
  const entries: {
    start: number;
    end: number;
    dataStart: number;
    compressed: number;
    raw: number;
    method: number;
  }[] = [];
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      return bad();
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true),
      raw = view.getUint32(offset + 24, true);
    const n = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (
      offset + 46 + n + extra + comment > end ||
      !n ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      local + 30 > offset ||
      view.getUint32(local, true) !== 0x04034b50
    )
      return bad();
    const localNameSize = view.getUint16(local + 26, true),
      localExtra = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localNameSize + localExtra;
    let dataEnd = dataStart + compressed;
    if (
      dataEnd > directoryStart ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method
    )
      return bad();
    const checksum = view.getUint32(offset + 16, true);
    if (flags & 8) {
      // Streaming ZIP writers put sizes in a descriptor instead of the local header.
      if (dataEnd + 12 > directoryStart) return bad();
      if (view.getUint32(dataEnd, true) === 0x08074b50) dataEnd += 4;
      if (
        dataEnd + 12 > directoryStart ||
        view.getUint32(dataEnd, true) !== checksum ||
        view.getUint32(dataEnd + 4, true) !== compressed ||
        view.getUint32(dataEnd + 8, true) !== raw
      )
        return bad();
      dataEnd += 12;
    } else if (
      view.getUint32(local + 14, true) !== checksum ||
      view.getUint32(local + 18, true) !== compressed ||
      view.getUint32(local + 22, true) !== raw
    )
      return bad();
    if (method === 0 && compressed !== raw) return bad();
    entries.push({
      start: local,
      end: dataEnd,
      dataStart,
      compressed,
      raw,
      method,
    });
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + n),
    );
    const localName = new TextDecoder().decode(
      bytes.subarray(local + 30, local + 30 + localNameSize),
    );
    if (
      name !== localName ||
      names.has(name) ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      /vbaproject|macros\/|encryptedpackage/i.test(name)
    )
      return bad();
    names.add(name);
    inflated += raw;
    if (
      inflated > 64 * 1024 * 1024 ||
      raw === 0xffffffff ||
      compressed === 0xffffffff
    )
      return bad();
    offset += 46 + n + extra + comment;
  }
  if (
    offset !== end ||
    !names.has("[Content_Types].xml") ||
    !names.has(OFFICE_FORMATS[format].part)
  )
    return bad();
  entries.sort((a, b) => a.start - b.start);
  let previousEnd = 0,
    actualTotal = 0;
  for (const entry of entries) {
    if (entry.start < previousEnd) return bad();
    previousEnd = entry.end;
    if (entry.method === 0) {
      actualTotal += entry.raw;
      continue;
    }
    let inputOffset = entry.dataStart,
      actualSize = 0;
    // Small input chunks bound the inflater's transient output even for high ratios.
    const compressedStream = new ReadableStream<BufferSource>({
      pull(controller) {
        const next = Math.min(
          inputOffset + 1024,
          entry.dataStart + entry.compressed,
        );
        if (inputOffset === next) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(inputOffset, next));
        inputOffset = next;
      },
    });
    const reader = compressedStream
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        actualSize += value.byteLength;
        actualTotal += value.byteLength;
        if (actualSize > entry.raw || actualTotal > 64 * 1024 * 1024)
          return bad();
      }
      if (actualSize !== entry.raw) return bad();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
