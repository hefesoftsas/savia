import {
  EDITOR_EXTENSION_LIMITS,
  editorExtensionMetadataSchema,
  type EditorExtensionMetadata,
} from "./plugin-editor-extensions";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface ParsedEditorVsix {
  metadata: EditorExtensionMetadata;
  manifest: Record<string, unknown>;
  files: Map<string, Uint8Array>;
}

export class EditorVsixError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EditorVsixError";
  }
}

interface ZipEntry {
  path: string;
  directory: boolean;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  expandedSize: number;
  localOffset: number;
  externalAttributes: number;
  nameBytes: Uint8Array;
}

function fail(code: string, message: string): never {
  throw new EditorVsixError(code, message);
}

function requireRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  code = "invalid-archive",
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    fail(code, "The VSIX archive is truncated or contains an invalid offset.");
  }
}

function uint16(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 2);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4);
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function decodeName(bytes: Uint8Array): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return fail("invalid-utf8", "VSIX file names must be valid UTF-8.");
  }
}

function validateExtraFields(
  bytes: Uint8Array,
  offset: number,
  length: number,
): void {
  const end = offset + length;
  while (offset < end) {
    if (offset + 4 > end)
      return fail("invalid-archive", "A ZIP extra field is truncated.");
    const id = uint16(bytes, offset);
    const size = uint16(bytes, offset + 2);
    if (offset + 4 + size > end)
      return fail(
        "invalid-archive",
        "A ZIP extra field has an inconsistent length.",
      );
    if (id === 0x0001)
      return fail("zip64-archive", "ZIP64 extra fields are not supported.");
    if (id === 0x7075)
      return fail(
        "ambiguous-path",
        "Unicode path extra fields are not supported.",
      );
    offset += 4 + size;
  }
}

function normalizedPath(path: string): { path: string; directory: boolean } {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\0")
  ) {
    return fail(
      "unsafe-path",
      "The VSIX contains an absolute or malformed path.",
    );
  }
  const directory = path.endsWith("/");
  const parts = (directory ? path.slice(0, -1) : path).split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return fail(
      "unsafe-path",
      "The VSIX contains an empty or traversing path segment.",
    );
  }
  const normalized = parts.map((part) => part.normalize("NFC")).join("/");
  return { path: normalized, directory };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function locateCentralDirectory(bytes: Uint8Array): {
  offset: number;
  size: number;
  count: number;
  endOffset: number;
} {
  if (bytes.length < 22)
    return fail(
      "invalid-archive",
      "The VSIX is too short to be a ZIP archive.",
    );
  const start = Math.max(0, bytes.length - 22 - 65_535);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= start; offset--) {
    if (uint32(bytes, offset) === 0x06054b50) {
      const commentLength = uint16(bytes, offset + 20);
      if (offset + 22 + commentLength === bytes.length) {
        eocd = offset;
        break;
      }
    }
  }
  if (eocd < 0)
    return fail(
      "invalid-archive",
      "The VSIX is missing a valid ZIP directory record.",
    );
  const disk = uint16(bytes, eocd + 4);
  const centralDisk = uint16(bytes, eocd + 6);
  const diskCount = uint16(bytes, eocd + 8);
  const count = uint16(bytes, eocd + 10);
  const size = uint32(bytes, eocd + 12);
  const offset = uint32(bytes, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskCount !== count)
    return fail(
      "multipart-archive",
      "Multipart ZIP archives are not supported.",
    );
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
    return fail("zip64-archive", "ZIP64 archives are not supported.");
  if (count > EDITOR_EXTENSION_LIMITS.files)
    return fail("file-count-limit", "The VSIX has too many archive entries.");
  if (offset + size !== eocd)
    return fail(
      "invalid-archive",
      "The VSIX central directory has an inconsistent size or offset.",
    );
  requireRange(bytes, offset, size);
  return { offset, size, count, endOffset: eocd };
}

function readEntries(bytes: Uint8Array): ZipEntry[] {
  const directory = locateCentralDirectory(bytes);
  const entries: ZipEntry[] = [];
  const seenEntries = new Set<string>();
  const pathKinds = new Map<string, "file" | "directory">();
  let offset = directory.offset;
  for (let index = 0; index < directory.count; index++) {
    requireRange(bytes, offset, 46);
    if (uint32(bytes, offset) !== 0x02014b50)
      return fail("invalid-archive", "A central directory entry is malformed.");
    const madeBy = uint16(bytes, offset + 4);
    const flags = uint16(bytes, offset + 8);
    const method = uint16(bytes, offset + 10);
    const crc = uint32(bytes, offset + 16);
    const compressedSize = uint32(bytes, offset + 20);
    const expandedSize = uint32(bytes, offset + 24);
    const nameLength = uint16(bytes, offset + 28);
    const extraLength = uint16(bytes, offset + 30);
    const commentLength = uint16(bytes, offset + 32);
    const startDisk = uint16(bytes, offset + 34);
    const externalAttributes = uint32(bytes, offset + 38);
    const localOffset = uint32(bytes, offset + 42);
    if (
      startDisk !== 0 ||
      compressedSize === 0xffffffff ||
      expandedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      return fail(
        "zip64-archive",
        "ZIP64 or split archive entries are not supported.",
      );
    }
    if (flags & 0x0001)
      return fail(
        "encrypted-archive",
        "Encrypted VSIX archives are not supported.",
      );
    if (flags & 0x0040)
      return fail(
        "encrypted-archive",
        "Strongly encrypted VSIX archives are not supported.",
      );
    if (flags & ~(0x0808 | 0x0006))
      return fail(
        "unsupported-zip-flags",
        "The VSIX uses unsupported ZIP flags.",
      );
    if (method !== 0 && method !== 8)
      return fail(
        "unsupported-compression",
        "The VSIX uses an unsupported compression method.",
      );
    if (expandedSize > EDITOR_EXTENSION_LIMITS.fileBytes)
      return fail("file-size-limit", "An expanded VSIX file is too large.");
    const nameStart = offset + 46;
    requireRange(bytes, nameStart, nameLength + extraLength + commentLength);
    validateExtraFields(bytes, nameStart + nameLength, extraLength);
    const nameBytes = bytes.slice(nameStart, nameStart + nameLength);
    const normalized = normalizedPath(decodeName(nameBytes));
    const key = normalized.path.toLocaleLowerCase("en-US");
    if (seenEntries.has(key))
      return fail(
        "duplicate-path",
        "The VSIX contains duplicate normalized paths.",
      );
    const existingKind = pathKinds.get(key);
    if (
      (normalized.directory && existingKind === "file") ||
      (!normalized.directory && existingKind === "directory")
    )
      return fail(
        "path-collision",
        "A VSIX path is used as both a file and a directory.",
      );
    const parts = key.split("/");
    for (let part = 1; part < parts.length; part++) {
      const parent = parts.slice(0, part).join("/");
      if (pathKinds.get(parent) === "file")
        return fail(
          "path-collision",
          "A VSIX file path is also used as a parent directory.",
        );
      pathKinds.set(parent, "directory");
    }
    pathKinds.set(key, normalized.directory ? "directory" : "file");
    seenEntries.add(key);
    const unixMode = madeBy >>> 8 === 3 ? externalAttributes >>> 16 : 0;
    if ((unixMode & 0o170000) === 0o120000)
      return fail("symlink", "Symbolic links are not allowed in a VSIX.");
    if (
      normalized.directory &&
      (expandedSize !== 0 || compressedSize !== 0 || crc !== 0)
    )
      return fail("invalid-archive", "Directory entries cannot contain data.");
    entries.push({
      ...normalized,
      flags,
      method,
      crc,
      compressedSize,
      expandedSize,
      localOffset,
      externalAttributes,
      nameBytes,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (offset !== directory.endOffset)
    return fail(
      "invalid-archive",
      "The VSIX central directory contains trailing or missing data.",
    );
  if (
    entries.filter((entry) => !entry.directory).length >
    EDITOR_EXTENSION_LIMITS.files
  ) {
    return fail("file-count-limit", "The VSIX has too many files.");
  }
  return entries;
}

function localPayload(
  bytes: Uint8Array,
  entry: ZipEntry,
  centralOffset: number,
): { start: number; end: number; recordEnd: number } {
  const offset = entry.localOffset;
  requireRange(bytes, offset, 30);
  if (uint32(bytes, offset) !== 0x04034b50)
    return fail("invalid-archive", "A local ZIP header is malformed.");
  const flags = uint16(bytes, offset + 6);
  const method = uint16(bytes, offset + 8);
  const crc = uint32(bytes, offset + 14);
  const compressed = uint32(bytes, offset + 18);
  const expanded = uint32(bytes, offset + 22);
  const nameLength = uint16(bytes, offset + 26);
  const extraLength = uint16(bytes, offset + 28);
  requireRange(bytes, offset + 30, nameLength + extraLength);
  validateExtraFields(bytes, offset + 30 + nameLength, extraLength);
  const nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLength);
  const usesDescriptor = (entry.flags & 0x0008) !== 0;
  const localValueMatches = (local: number, central: number) =>
    usesDescriptor ? local === 0 || local === central : local === central;
  if (
    flags !== entry.flags ||
    method !== entry.method ||
    !localValueMatches(crc, entry.crc) ||
    !localValueMatches(compressed, entry.compressedSize) ||
    !localValueMatches(expanded, entry.expandedSize) ||
    nameLength !== entry.nameBytes.length ||
    nameBytes.some((byte, index) => byte !== entry.nameBytes[index])
  ) {
    return fail(
      "inconsistent-header",
      "A local ZIP header does not match its central directory record.",
    );
  }
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > centralOffset)
    return fail(
      "invalid-archive",
      "A local ZIP entry overlaps the central directory.",
    );
  requireRange(bytes, start, entry.compressedSize);
  let recordEnd = end;
  if (usesDescriptor) {
    const remaining = centralOffset - end;
    if (remaining < 12)
      return fail(
        "invalid-data-descriptor",
        "A ZIP data descriptor is truncated.",
      );
    const first = uint32(bytes, end);
    let descriptorLength = 12;
    if (first === 0x08074b50) {
      if (remaining >= 16) {
        const signedMatches =
          uint32(bytes, end + 4) === entry.crc &&
          uint32(bytes, end + 8) === entry.compressedSize &&
          uint32(bytes, end + 12) === entry.expandedSize;
        if (signedMatches) {
          descriptorLength = 16;
        }
      }
    }
    if (descriptorLength === 12) {
      if (
        first !== entry.crc ||
        uint32(bytes, end + 4) !== entry.compressedSize ||
        uint32(bytes, end + 8) !== entry.expandedSize
      ) {
        return fail(
          "invalid-data-descriptor",
          "A ZIP data descriptor does not match its directory record.",
        );
      }
    }
    recordEnd = end + descriptorLength;
    if (recordEnd > centralOffset)
      return fail(
        "invalid-data-descriptor",
        "A ZIP data descriptor overlaps the central directory.",
      );
  }
  return { start, end, recordEnd };
}

async function inflate(
  entryBytes: Uint8Array,
  method: number,
  expectedSize: number,
): Promise<Uint8Array> {
  if (method === 0) {
    if (entryBytes.length !== expectedSize)
      return fail(
        "inconsistent-header",
        "A stored ZIP entry has inconsistent sizes.",
      );
    return entryBytes.slice();
  }
  let stream: DecompressionStream;
  try {
    const Constructor = DecompressionStream as unknown as new (
      format: string,
    ) => DecompressionStream;
    stream = new Constructor("deflate-raw");
  } catch {
    return fail(
      "unsupported-compression",
      "This runtime cannot safely decode deflated VSIX entries.",
    );
  }
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const ownedEntryBytes = new Uint8Array(entryBytes.byteLength);
  ownedEntryBytes.set(entryBytes);
  const writeTask = writer.write(ownedEntryBytes).then(() => writer.close());
  void writeTask.catch(() => undefined);
  const output = new Uint8Array(expectedSize);
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedSize || total > EDITOR_EXTENSION_LIMITS.fileBytes) {
        await reader.cancel();
        return fail(
          "expanded-size-mismatch",
          "A VSIX entry expanded beyond its declared or allowed size.",
        );
      }
      output.set(value, total - value.byteLength);
    }
    await writeTask;
  } catch (error) {
    if (error instanceof EditorVsixError) throw error;
    return fail(
      "invalid-deflate-stream",
      "A VSIX entry has an invalid or truncated deflate stream.",
    );
  }
  if (total !== expectedSize)
    return fail(
      "expanded-size-mismatch",
      "A VSIX entry expanded to a different size than declared.",
    );
  return output;
}

type JavaScriptToken = {
  kind: "identifier" | "string" | "punctuation";
  value: string;
};

function javascriptTokens(source: string): JavaScriptToken[] {
  const tokens: JavaScriptToken[] = [];
  let previous: JavaScriptToken | undefined;
  const push = (token: JavaScriptToken) => {
    tokens.push(token);
    previous = token;
  };
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      )
        index++;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (
      character === "/" &&
      (previous === undefined ||
        (previous.kind === "punctuation" &&
          "([{=,:;!&|?+-*%^~<>".includes(previous.value)) ||
        (previous.kind === "punctuation" && previous.value === ">") ||
        (previous.kind === "identifier" &&
          [
            "return",
            "throw",
            "case",
            "delete",
            "void",
            "typeof",
            "instanceof",
            "in",
            "of",
            "yield",
            "await",
          ].includes(previous.value)))
    ) {
      index++;
      let inClass = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "[") inClass = true;
        else if (source[index] === "]") inClass = false;
        else if (source[index] === "/" && !inClass) {
          index++;
          while (index < source.length && /[A-Za-z]/.test(source[index]))
            index++;
          break;
        }
        index++;
      }
      push({ kind: "string", value: "<regexp>" });
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      index++;
      let value = "";
      let interpolated = false;
      while (index < source.length && source[index] !== quote) {
        const next = source[index++];
        if (quote === "`" && next === "$" && source[index] === "{") {
          interpolated = true;
          break;
        }
        if (next !== "\\" || index >= source.length) {
          value += next;
          continue;
        }
        const escaped = source[index++];
        const escapes: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
          v: "\v",
          "0": "\0",
        };
        if (
          escaped === "x" &&
          /^[\da-f]{2}$/i.test(source.slice(index, index + 2))
        ) {
          value += String.fromCharCode(
            Number.parseInt(source.slice(index, index + 2), 16),
          );
          index += 2;
        } else if (
          escaped === "u" &&
          /^[\da-f]{4}$/i.test(source.slice(index, index + 4))
        ) {
          value += String.fromCharCode(
            Number.parseInt(source.slice(index, index + 4), 16),
          );
          index += 4;
        } else if (escaped === "\n" || escaped === "\r") {
          if (escaped === "\r" && source[index] === "\n") index++;
        } else {
          value += escapes[escaped] ?? escaped;
        }
      }
      if (index < source.length && source[index] === quote) index++;
      if (quote === "`" && interpolated) {
        // A computed module specifier cannot be safely classified statically.
        push({ kind: "string", value: "<computed>" });
        let depth = 1;
        while (index < source.length && depth > 0) {
          if (source[index] === "{") depth++;
          else if (source[index] === "}") depth--;
          index++;
        }
        while (index < source.length && source[index] !== "`") index++;
        if (index < source.length) index++;
      } else {
        push({ kind: "string", value });
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index++;
      while (index < source.length && /[\w$]/.test(source[index])) index++;
      push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }
    push({ kind: "punctuation", value: character });
    index++;
  }
  return tokens;
}

function importsNodeBuiltin(source: string): boolean {
  const builtins = new Set(
    "_http_agent _http_client _http_common _http_incoming _http_outgoing _http_server _stream_duplex _stream_passthrough _stream_readable _stream_transform _stream_wrap _stream_writable _tls_common _tls_wrap assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http https inspector inspector/promises module net os path perf_hooks process punycode querystring readline readline/promises repl stream stream/promises stream/web string_decoder sys test test/reporters test/mock timers timers/promises tls trace_events tty url util v8 vm wasi worker_threads zlib sqlite sea".split(
      " ",
    ),
  );
  const tokens = javascriptTokens(source);
  const isBuiltin = (specifier: string) => {
    const normalized = specifier.startsWith("node:")
      ? specifier.slice("node:".length)
      : specifier;
    const root = normalized.split("/")[0];
    return builtins.has(root) || builtins.has(normalized);
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== "identifier") continue;
    const next = tokens[index + 1];
    const following = tokens[index + 2];
    if (
      token.value === "require" &&
      next?.value === "(" &&
      following?.kind === "string" &&
      isBuiltin(following.value)
    )
      return true;
    if (
      token.value === "import" &&
      next?.kind === "string" &&
      isBuiltin(next.value)
    )
      return true;
    if (
      token.value === "import" &&
      next?.value === "(" &&
      following?.kind === "string" &&
      isBuiltin(following.value)
    )
      return true;
    if (
      token.value === "from" &&
      next?.kind === "string" &&
      isBuiltin(next.value)
    )
      return true;
  }
  return false;
}

type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

function parseSemver(version: string): SemanticVersion | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && /^0\d+$/.test(part)))
    return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return Number.NaN;
  for (const key of ["major", "minor", "patch"] as const)
    if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length === b.prerelease.length
      ? 0
      : a.prerelease.length
        ? -1
        : 1;
  for (
    let index = 0;
    index < Math.max(a.prerelease.length, b.prerelease.length);
    index++
  ) {
    const leftId = a.prerelease[index];
    const rightId = b.prerelease[index];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    if (leftId === rightId) continue;
    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) {
      if (leftId.length !== rightId.length)
        return leftId.length < rightId.length ? -1 : 1;
      return leftId < rightId ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftId < rightId ? -1 : 1;
  }
  return 0;
}

function parsePartialVersion(
  version: string,
): { lower: string; upper: string | null } | null {
  if (version === "*" || /^x$/i.test(version))
    return { lower: "0.0.0", upper: null };
  const parts = version.split(".");
  if (
    parts.length > 3 ||
    parts.some((part) => !/^(?:0|[1-9]\d*|x|\*)$/i.test(part))
  )
    return null;
  const wildcard = parts.findIndex((part) => /^(?:x|\*)$/i.test(part));
  if (
    wildcard >= 0 &&
    parts.slice(wildcard).some((part) => !/^(?:x|\*)$/i.test(part))
  )
    return null;
  const defined = wildcard >= 0 ? wildcard : parts.length;
  const nums = parts.slice(0, defined).map(Number);
  const lowerNums = [...nums, 0, 0].slice(0, 3);
  const lower = lowerNums.join(".");
  if (defined === 3) return { lower, upper: null };
  if (defined === 0) return { lower, upper: null };
  const upperNums = lowerNums.slice();
  upperNums[defined - 1]++;
  for (let index = defined; index < 3; index++) upperNums[index] = 0;
  return { lower, upper: upperNums.join(".") };
}

function compareToComparator(
  version: string,
  comparator: string,
): boolean | null {
  const match =
    /^(<=|>=|<|>|=|\^|~)?\s*(\d+(?:\.(?:\d+|x|\*)){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/i.exec(
      comparator,
    );
  if (!match) return null;
  const operator = match[1] ?? "=";
  const target = match[2];
  const exactVersion = parseSemver(target);
  if (operator === "^" || operator === "~") {
    const partial = exactVersion
      ? { lower: target, upper: null }
      : parsePartialVersion(target);
    if (!partial) return null;
    const comparison = compareSemver(version, partial.lower);
    if (!Number.isFinite(comparison)) return null;
    const parts = target.split(".");
    const wildcardIndex = parts.findIndex((part) => /^(?:x|\*)$/i.test(part));
    const specified = exactVersion
      ? 3
      : wildcardIndex < 0
        ? parts.length
        : wildcardIndex;
    const major = exactVersion ? exactVersion.major : Number(parts[0]);
    const minor = exactVersion ? exactVersion.minor : Number(parts[1] ?? 0);
    const patch = exactVersion ? exactVersion.patch : Number(parts[2] ?? 0);
    const upper =
      operator === "~"
        ? specified <= 1
          ? `${major + 1}.0.0`
          : `${major}.${minor + 1}.0`
        : major > 0 || specified <= 1
          ? `${major + 1}.0.0`
          : minor > 0 || specified === 2
            ? `0.${minor + 1}.0`
            : `0.0.${patch + 1}`;
    return comparison >= 0 && compareSemver(version, upper) < 0;
  }
  if (exactVersion) {
    const comparison = compareSemver(version, target);
    if (!Number.isFinite(comparison)) return null;
    if (operator === "=") return comparison === 0;
    if (operator === "<") return comparison < 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === ">") return comparison > 0;
    if (operator === ">=") return comparison >= 0;
    return null;
  }
  const partial = parsePartialVersion(target);
  if (!partial || target.includes("*") || /x/i.test(target)) return null;
  if (partial.upper && operator === "=") {
    return (
      compareSemver(version, partial.lower) >= 0 &&
      compareSemver(version, partial.upper) < 0
    );
  }
  const exactTarget = partial.lower;
  const comparison = compareSemver(version, exactTarget);
  if (!Number.isFinite(comparison)) return null;
  if (operator === "=") return comparison === 0;
  if (operator === "<") return comparison < 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === ">=") return comparison >= 0;
  return null;
}

function satisfiesEngineRange(version: string, range: string): boolean | null {
  if (!parseSemver(version)) return null;
  const alternatives = range.split("||");
  if (alternatives.some((part) => !part.trim())) return null;
  for (const alternative of alternatives) {
    const trimmed = alternative.trim();
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
    if (hyphen) {
      const low = parseSemver(hyphen[1])
        ? { lower: hyphen[1], upper: null }
        : parsePartialVersion(hyphen[1]);
      const high = parseSemver(hyphen[2])
        ? { lower: hyphen[2], upper: null }
        : parsePartialVersion(hyphen[2]);
      if (!low || !high) return null;
      const lowerOkay = compareSemver(version, low.lower) >= 0;
      const upperOkay = high.upper
        ? compareSemver(version, high.upper) < 0
        : compareSemver(version, high.lower) <= 0;
      if (lowerOkay && upperOkay) return true;
      continue;
    }
    const tokens = trimmed.split(/\s+/);
    let alternativeOkay = true;
    for (const token of tokens) {
      const wildcard = /^(<=|>=|<|>|=)?(.*)$/.exec(token)!;
      const operator = wildcard[1] ?? "";
      const target = wildcard[2];
      if (/^[~^]/.test(target)) {
        const accepted = compareToComparator(version, target);
        if (accepted === null) return null;
        alternativeOkay &&= accepted;
      } else if (/^(?:\*|x|\d+(?:\.(?:\d+|x|\*)){0,2})$/i.test(target)) {
        const partial = parsePartialVersion(target);
        if (!partial) return null;
        if (!operator) {
          alternativeOkay &&=
            compareSemver(version, partial.lower) >= 0 &&
            (!partial.upper || compareSemver(version, partial.upper) < 0);
        } else {
          const comparison = compareSemver(version, partial.lower);
          if (!Number.isFinite(comparison)) return null;
          // npm-style partial comparators use the next partial boundary:
          // `>1.2` is `>=1.3.0`, while `<=1.2` is `<1.3.0`.
          const nextBoundary = partial.upper;
          const accepted =
            operator === "<"
              ? comparison < 0
              : operator === "<="
                ? nextBoundary
                  ? compareSemver(version, nextBoundary) < 0
                  : comparison <= 0
                : operator === ">"
                  ? nextBoundary
                    ? compareSemver(version, nextBoundary) >= 0
                    : comparison > 0
                  : operator === ">="
                    ? comparison >= 0
                    : nextBoundary
                      ? comparison >= 0 &&
                        compareSemver(version, nextBoundary) < 0
                      : comparison === 0;
          alternativeOkay &&= accepted;
        }
      } else {
        const accepted = compareToComparator(version, `${operator}${target}`);
        if (accepted === null) return null;
        alternativeOkay &&= accepted;
      }
    }
    if (alternativeOkay) return true;
  }
  return false;
}

function collectDeclaredResources(manifest: Record<string, unknown>): string[] {
  const resources: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && !trimmed.startsWith("data:")) resources.push(trimmed);
  };
  add(manifest.browser);
  add(manifest.main);
  add(manifest.icon);
  const contributes = manifest.contributes;
  if (
    contributes &&
    typeof contributes === "object" &&
    !Array.isArray(contributes)
  ) {
    for (const [key, value] of Object.entries(
      contributes as Record<string, unknown>,
    )) {
      if (!["themes", "snippets", "grammars", "languages"].includes(key))
        continue;
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const contribution = item as Record<string, unknown>;
        add(contribution.path);
        add(contribution.configuration);
      }
    }
  }
  return resources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => nonemptyString(item)))
  );
}

function supportedDeclarativeContributions(
  manifest: Record<string, unknown>,
): boolean {
  const contributes = manifest.contributes;
  if (!isRecord(contributes)) return contributes === undefined;

  if (contributes.themes !== undefined) {
    if (!Array.isArray(contributes.themes)) return false;
    for (const theme of contributes.themes) {
      if (
        !isRecord(theme) ||
        !nonemptyString(theme.label) ||
        !nonemptyString(theme.path) ||
        !["vs", "vs-dark", "hc-black", "hc-light"].includes(
          String(theme.uiTheme),
        )
      )
        return false;
    }
  }

  if (contributes.snippets !== undefined) {
    if (!Array.isArray(contributes.snippets)) return false;
    for (const snippet of contributes.snippets) {
      if (
        !isRecord(snippet) ||
        !nonemptyString(snippet.path) ||
        (snippet.language !== undefined && !nonemptyString(snippet.language))
      )
        return false;
    }
  }

  if (contributes.grammars !== undefined) {
    if (!Array.isArray(contributes.grammars)) return false;
    for (const grammar of contributes.grammars) {
      if (
        !isRecord(grammar) ||
        !nonemptyString(grammar.path) ||
        !nonemptyString(grammar.scopeName) ||
        (grammar.language !== undefined && !nonemptyString(grammar.language)) ||
        !optionalStringArray(grammar.injectTo)
      )
        return false;
    }
  }

  if (contributes.languages !== undefined) {
    if (!Array.isArray(contributes.languages)) return false;
    for (const language of contributes.languages) {
      if (
        !isRecord(language) ||
        !nonemptyString(language.id) ||
        !optionalStringArray(language.aliases) ||
        !optionalStringArray(language.extensions) ||
        !optionalStringArray(language.filenames) ||
        !optionalStringArray(language.filenamePatterns) ||
        (language.firstLine !== undefined &&
          typeof language.firstLine !== "string")
      )
        return false;
      if (
        language.configuration !== undefined &&
        !nonemptyString(language.configuration)
      )
        return false;
    }
  }
  return true;
}

function resolveResourcePath(path: string): string {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)
  ) {
    return fail(
      "unsafe-resource-path",
      "A package resource path must remain inside extension/.",
    );
  }
  const stack = ["extension"];
  const parts = path.replace(/^\.\//, "").split("/");
  if (parts.some((part) => part === "" || part === "..")) {
    return fail(
      "unsafe-resource-path",
      "A package resource path contains an empty or traversing segment.",
    );
  }
  for (const part of parts) if (part !== ".") stack.push(part.normalize("NFC"));
  return stack.join("/");
}

/** Manifest preflight only; archive resources and browser code need VSIX inspection. */
export function editorManifestCompatibility(
  manifest: Record<string, unknown>,
  runtimeVersion: string,
): { supported: boolean; reason: string | null } {
  const engines = manifest.engines;
  const vscodeRange =
    engines && typeof engines === "object"
      ? (engines as Record<string, unknown>).vscode
      : null;
  if (typeof vscodeRange !== "string")
    return { supported: false, reason: "invalid-engine-range" };
  const compatible = satisfiesEngineRange(runtimeVersion, vscodeRange);
  if (compatible === null)
    return { supported: false, reason: "invalid-engine-range" };
  if (!compatible) return { supported: false, reason: "incompatible-engine" };

  if (
    Array.isArray(manifest.enabledApiProposals) &&
    manifest.enabledApiProposals.length > 0
  ) {
    return { supported: false, reason: "unsupported-api" };
  }
  if (manifest.main && !manifest.browser)
    return { supported: false, reason: "desktop-only" };
  const contributes = manifest.contributes;
  if (
    contributes !== undefined &&
    (!contributes ||
      typeof contributes !== "object" ||
      Array.isArray(contributes))
  ) {
    return { supported: false, reason: "unsupported-contributions" };
  }
  if (
    contributes &&
    Object.keys(contributes as object).some(
      (key) => !["themes", "snippets", "grammars", "languages"].includes(key),
    )
  ) {
    return { supported: false, reason: "unsupported-contributions" };
  }
  if (!supportedDeclarativeContributions(manifest)) {
    return { supported: false, reason: "unsupported-contributions" };
  }

  return { supported: true, reason: null };
}

function compatibilityFor(
  manifest: Record<string, unknown>,
  runtimeVersion: string,
  files: Map<string, Uint8Array>,
): { supported: boolean; reason: string | null } {
  const preflight = editorManifestCompatibility(manifest, runtimeVersion);
  if (!preflight.supported) return preflight;

  if (manifest.browser) {
    const path = resolveResourcePath(manifest.browser as string);
    const browserBytes = files.get(path);
    if (!browserBytes)
      return { supported: false, reason: "missing-browser-resource" };
    let source: string;
    try {
      source = utf8Decoder.decode(browserBytes);
    } catch {
      return { supported: false, reason: "invalid-browser-resource" };
    }
    const executableSource = javascriptTokens(source)
      .filter((token) => token.kind !== "string")
      .map((token) => token.value)
      .join(" ");
    const unavailableEditorApi =
      /\bvscode\s*\.\s*(?:authentication|debug|tasks|scm|notebooks)\b|\bvscode\s*\.\s*window\s*\.\s*(?:createTerminal|createWebviewPanel)\b|\bvscode\s*\.\s*env\s*\.\s*openExternal\b/;
    if (
      importsNodeBuiltin(source) ||
      unavailableEditorApi.test(executableSource)
    ) {
      return { supported: false, reason: "unsupported-api" };
    }
  }
  return { supported: true, reason: null };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function parseEditorVsix(
  bytes: Uint8Array,
  runtimeVersion: string,
): Promise<ParsedEditorVsix> {
  if (!(bytes instanceof Uint8Array))
    return fail("invalid-archive", "VSIX input must be bytes.");
  if (bytes.byteLength > EDITOR_EXTENSION_LIMITS.compressedBytes)
    return fail("compressed-size-limit", "The compressed VSIX exceeds 20 MiB.");
  if (!parseSemver(runtimeVersion))
    return fail(
      "invalid-runtime-version",
      "The editor runtime version is invalid.",
    );
  const ownedArchive = new Uint8Array(bytes.byteLength);
  ownedArchive.set(bytes);
  bytes = ownedArchive;
  const directory = locateCentralDirectory(bytes);
  const entries = readEntries(bytes);
  const localRanges = entries
    .map((entry) => ({
      entry,
      ...localPayload(bytes, entry, directory.offset),
    }))
    .sort((a, b) => a.start - b.start);
  if (localRanges.length && localRanges[0].entry.localOffset !== 0)
    return fail(
      "invalid-archive",
      "The VSIX contains data before its first ZIP entry.",
    );
  for (let index = 1; index < localRanges.length; index++) {
    if (localRanges[index].start < localRanges[index - 1].end)
      return fail(
        "overlapping-entries",
        "VSIX entries overlap in the archive.",
      );
    if (
      localRanges[index].entry.localOffset !== localRanges[index - 1].recordEnd
    )
      return fail(
        "invalid-archive",
        "The VSIX contains unindexed data between ZIP entries.",
      );
  }
  if (
    localRanges.length &&
    localRanges[localRanges.length - 1].recordEnd !== directory.offset
  )
    return fail(
      "invalid-archive",
      "The VSIX contains unindexed data before its central directory.",
    );
  const files = new Map<string, Uint8Array>();
  let expandedBytes = 0;
  for (const range of localRanges) {
    if (range.entry.directory) continue;
    expandedBytes += range.entry.expandedSize;
    if (expandedBytes > EDITOR_EXTENSION_LIMITS.expandedBytes)
      return fail("expanded-size-limit", "The VSIX expands beyond 64 MiB.");
    const content = await inflate(
      bytes.subarray(range.start, range.end),
      range.entry.method,
      range.entry.expandedSize,
    );
    if (crc32(content) !== range.entry.crc)
      return fail("crc-mismatch", "A VSIX file failed its CRC checksum.");
    files.set(range.entry.path, content);
  }
  const manifestBytes = files.get("extension/package.json");
  if (!manifestBytes)
    return fail(
      "missing-manifest",
      "The VSIX must contain extension/package.json.",
    );
  let manifest: Record<string, unknown>;
  try {
    const decoded = JSON.parse(utf8Decoder.decode(manifestBytes)) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
      throw new Error("not an object");
    manifest = decoded as Record<string, unknown>;
  } catch {
    return fail(
      "invalid-manifest",
      "extension/package.json must be valid UTF-8 JSON.",
    );
  }
  const publisher = manifest.publisher;
  const name = manifest.name;
  const version = manifest.version;
  if (
    typeof publisher !== "string" ||
    typeof name !== "string" ||
    typeof version !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(publisher) ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(name)
  ) {
    return fail(
      "invalid-identity",
      "The manifest publisher and name must be valid extension identifiers.",
    );
  }
  if (!parseSemver(version))
    return fail(
      "invalid-version",
      "The manifest version must be semantic versioning.",
    );
  for (const key of ["main", "browser", "icon"]) {
    if (manifest[key] !== undefined && typeof manifest[key] !== "string")
      return fail(
        "invalid-manifest",
        `Manifest ${key} must be a package-relative path.`,
      );
  }
  const dependenciesValue = manifest.extensionDependencies ?? [];
  if (
    !Array.isArray(dependenciesValue) ||
    dependenciesValue.some(
      (dependency) =>
        typeof dependency !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}\.[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(
          dependency,
        ),
    )
  ) {
    return fail(
      "invalid-dependency",
      "Extension dependencies must be valid publisher.name identifiers.",
    );
  }
  const dependencies = [
    ...new Set(
      dependenciesValue.map((dependency) =>
        (dependency as string).toLowerCase(),
      ),
    ),
  ];
  if (
    dependencies.length !== dependenciesValue.length ||
    dependencies.some(
      (dependency) => dependency === `${publisher}.${name}`.toLowerCase(),
    )
  ) {
    return fail(
      "invalid-dependency",
      "Extension dependencies must be unique and cannot include the package itself.",
    );
  }
  if (
    manifest.extensionPack !== undefined &&
    (!Array.isArray(manifest.extensionPack) ||
      manifest.extensionPack.some(
        (id) =>
          typeof id !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}\.[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(
            id,
          ),
      ))
  ) {
    return fail(
      "invalid-dependency",
      "Extension packs must contain valid publisher.name identifiers.",
    );
  }
  const licenseValue = manifest.license;
  const license =
    typeof licenseValue === "string" && licenseValue.trim()
      ? licenseValue.trim().slice(0, 200)
      : null;
  for (const resource of collectDeclaredResources(manifest)) {
    const path = resolveResourcePath(resource);
    if (!files.has(path))
      return fail(
        resource === manifest.browser
          ? "missing-browser-resource"
          : "missing-resource",
        `Declared resource ${resource} is missing from the VSIX.`,
      );
  }
  const compatibility = compatibilityFor(manifest, runtimeVersion, files);
  const metadata: EditorExtensionMetadata = editorExtensionMetadataSchema.parse(
    {
      id: `${publisher}.${name}`.toLowerCase(),
      publisher,
      name,
      version,
      sha256: await sha256(bytes),
      license,
      compressedBytes: bytes.byteLength,
      expandedBytes,
      dependencies,
      compatibility,
    },
  );
  return { metadata, manifest, files };
}
