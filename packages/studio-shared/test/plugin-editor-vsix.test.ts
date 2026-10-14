import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EDITOR_EXTENSION_LIMITS } from "../src/plugin-editor-extensions";
import {
  editorManifestCompatibility,
  parseEditorVsix,
} from "../src/plugin-editor-vsix";

describe("marketplace manifest preflight", () => {
  const base = { engines: { vscode: "^1.130.0" } };

  it.each([
    [{ main: "./out/extension.js" }, "desktop-only"],
    [{ enabledApiProposals: ["chatProvider"] }, "unsupported-api"],
    [
      { contributes: { commands: [{ command: "acme.run" }] } },
      "unsupported-contributions",
    ],
    [
      { contributes: { snippets: [{ language: "typescript" }] } },
      "unsupported-contributions",
    ],
    [{ engines: { vscode: "^2.0.0" } }, "incompatible-engine"],
    [{ engines: { vscode: "not-a-version" } }, "invalid-engine-range"],
  ])("rejects a manifest before package download: %j", (extra, reason) => {
    expect(
      editorManifestCompatibility({ ...base, ...extra }, "1.138.0"),
    ).toEqual({ supported: false, reason });
  });

  it("accepts supported declarative contributions without requiring archive resources", () => {
    expect(
      editorManifestCompatibility(
        {
          ...base,
          contributes: {
            snippets: [{ language: "typescript", path: "./snippets.json" }],
          },
        },
        "1.138.0",
      ),
    ).toEqual({ supported: true, reason: null });
  });

  it("leaves browser resource and code checks to full VSIX inspection", () => {
    expect(
      editorManifestCompatibility(
        { ...base, browser: "./dist/extension.js" },
        "1.138.0",
      ),
    ).toEqual({ supported: true, reason: null });
  });
});

const utf8 = new TextEncoder();
const manifest = (overrides: Record<string, unknown> = {}) =>
  utf8.encode(
    JSON.stringify({
      publisher: "acme",
      name: "browser-tools",
      version: "1.2.3",
      engines: { vscode: "^1.130.0" },
      browser: "./dist/extension.js",
      main: "./dist/extension.js",
      license: "MIT",
      contributes: {},
      ...overrides,
    }),
  );

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

function zip(
  entries: Array<{
    name: string;
    data: Uint8Array;
    method?: 0 | 8;
    externalAttributes?: number;
    descriptor?: "signed" | "unsigned" | "truncated";
  }>,
): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const compressed =
      entry.method === 8 ? deflateRawSync(entry.data) : Buffer.from(entry.data);
    const method = entry.method ?? 0;
    const flags = entry.descriptor ? 0x0008 : 0;
    const crc = crc32(entry.data);
    const lh = Buffer.alloc(30 + name.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(entry.descriptor ? 0 : crc, 14);
    lh.writeUInt32LE(entry.descriptor ? 0 : compressed.length, 18);
    lh.writeUInt32LE(entry.descriptor ? 0 : entry.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    Buffer.from(name).copy(lh, 30);
    local.push(lh, compressed);
    if (entry.descriptor) {
      const descriptor = Buffer.alloc(entry.descriptor === "signed" ? 16 : 12);
      let descriptorOffset = 0;
      if (entry.descriptor === "signed") {
        descriptor.writeUInt32LE(0x08074b50, descriptorOffset);
        descriptorOffset += 4;
      }
      descriptor.writeUInt32LE(crc, descriptorOffset);
      descriptor.writeUInt32LE(compressed.length, descriptorOffset + 4);
      descriptor.writeUInt32LE(entry.data.length, descriptorOffset + 8);
      local.push(
        entry.descriptor === "truncated"
          ? descriptor.subarray(0, descriptor.length - 5)
          : descriptor,
      );
    }
    const ch = Buffer.alloc(46 + name.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x031e, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(entry.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    ch.writeUInt32LE(offset, 42);
    Buffer.from(name).copy(ch, 46);
    central.push(ch);
    offset +=
      lh.length +
      compressed.length +
      (entry.descriptor === "signed"
        ? 16
        : entry.descriptor === "unsigned"
          ? 12
          : entry.descriptor === "truncated"
            ? 7
            : 0);
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, centralBytes, end]));
}

const archive = (
  manifestBytes = manifest(),
  files: Array<{ name: string; data: Uint8Array; method?: 0 | 8 }> = [],
) =>
  zip([
    { name: "extension/package.json", data: manifestBytes },
    {
      name: "extension/dist/extension.js",
      data: utf8.encode("export function activate() {}"),
      method: 8,
    },
    ...files,
  ]);

describe("parseEditorVsix", () => {
  it("parses a browser extension and hashes the original VSIX bytes", async () => {
    const bytes = archive();
    const parsed = await parseEditorVsix(bytes, "1.138.0");
    expect(parsed.metadata).toMatchObject({
      id: "acme.browser-tools",
      publisher: "acme",
      name: "browser-tools",
      version: "1.2.3",
      compressedBytes: bytes.length,
      expandedBytes: expect.any(Number),
      compatibility: { supported: true, reason: null },
    });
    expect(parsed.metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect([...parsed.files.get("extension/package.json")!]).toEqual([
      ...manifest(),
    ]);
  });

  it("accepts a supported theme and snippets package without executable code", async () => {
    const declarative = manifest({
      browser: undefined,
      main: undefined,
      contributes: {
        themes: [
          { label: "Quiet", uiTheme: "vs-dark", path: "./themes/quiet.json" },
        ],
        snippets: [
          { language: "typescript", path: "./snippets/typescript.json" },
        ],
      },
    });
    const parsed = await parseEditorVsix(
      zip([
        { name: "extension/package.json", data: declarative },
        { name: "extension/themes/quiet.json", data: utf8.encode("{}") },
        {
          name: "extension/snippets/typescript.json",
          data: utf8.encode('{"Greeting":{"prefix":"hi","body":"hello"}}'),
        },
      ]),
      "1.138.0",
    );
    expect(parsed.metadata.compatibility).toEqual({
      supported: true,
      reason: null,
    });
  });

  it("accepts a browser provider using the normal CommonJS vscode import", async () => {
    const browserCode = utf8.encode(
      "const vscode = require('vscode'); exports.activate = () => vscode.languages.registerCompletionItemProvider('plaintext', { provideCompletionItems: () => [] });",
    );
    const parsed = await parseEditorVsix(
      zip([
        { name: "extension/package.json", data: manifest() },
        { name: "extension/dist/extension.js", data: browserCode, method: 8 },
      ]),
      "1.138.0",
    );
    expect(parsed.metadata.compatibility).toEqual({
      supported: true,
      reason: null,
    });
  });

  it("does not mistake commented-out Node imports for executable code", async () => {
    const browserCode = utf8.encode(
      "// require('fs') is shown as an example only\nconst help = \"require('child_process') vscode.debug\"; const example = /require\\('node:fs'\\)/; exports.activate = () => {};",
    );
    const parsed = await parseEditorVsix(
      zip([
        { name: "extension/package.json", data: manifest() },
        { name: "extension/dist/extension.js", data: browserCode },
      ]),
      "1.138.0",
    );
    expect(parsed.metadata.compatibility).toEqual({
      supported: true,
      reason: null,
    });
  });

  it.each([
    "import { readFile } from 'node:fs';",
    "const childProcess = require('child_process');",
    "const fs = require('f\\x73');",
  ])("detects executable Node imports in browser code: %s", async (code) => {
    const parsed = await parseEditorVsix(
      zip([
        { name: "extension/package.json", data: manifest() },
        {
          name: "extension/dist/extension.js",
          data: utf8.encode(`${code} exports.activate = () => {};`),
        },
      ]),
      "1.138.0",
    );
    expect(parsed.metadata.compatibility).toEqual({
      supported: false,
      reason: "unsupported-api",
    });
  });

  it.each([
    [
      "themes",
      { themes: { label: "Dark", uiTheme: "vs-dark", path: "./theme.json" } },
    ],
    [
      "theme type",
      { themes: [{ label: "Dark", uiTheme: "mystery", path: "./theme.json" }] },
    ],
    ["snippets", { snippets: { path: "./snippets.json" } }],
    ["grammar scope", { grammars: [{ path: "./grammar.json" }] }],
    ["language id", { languages: [{ extensions: [".foo"] }] }],
  ])(
    "marks malformed declarative %s contributions unsupported",
    async (_label, contributes) => {
      const parsed = await parseEditorVsix(
        archive(manifest({ contributes }), [
          { name: "extension/theme.json", data: utf8.encode("{}") },
          { name: "extension/snippets.json", data: utf8.encode("{}") },
          { name: "extension/grammar.json", data: utf8.encode("{}") },
        ]),
        "1.138.0",
      );
      expect(parsed.metadata.compatibility).toEqual({
        supported: false,
        reason: "unsupported-contributions",
      });
    },
  );

  it("accepts VS Code JSONC theme and snippet resources", async () => {
    const parsed = await parseEditorVsix(
      archive(
        manifest({
          browser: undefined,
          main: undefined,
          contributes: {
            themes: [
              { label: "Dark", uiTheme: "vs-dark", path: "./theme.json" },
            ],
            snippets: [{ language: "typescript", path: "./snippets.json" }],
          },
        }),
        [
          {
            name: "extension/theme.json",
            data: utf8.encode('{"colors":{}, // VS Code JSONC comment\n}'),
          },
          {
            name: "extension/snippets.json",
            data: utf8.encode('{"Greeting":{"prefix":"hi","body":"hello"},}'),
          },
        ],
      ),
      "1.138.0",
    );
    expect(parsed.metadata.compatibility).toEqual({
      supported: true,
      reason: null,
    });
  });

  it("marks engine ranges incompatible and reports malformed semantic ranges", async () => {
    const incompatible = await parseEditorVsix(
      archive(manifest({ engines: { vscode: "^1.139.0" } })),
      "1.138.0",
    );
    expect(incompatible.metadata.compatibility).toEqual({
      supported: false,
      reason: "incompatible-engine",
    });
    const malformed = await parseEditorVsix(
      archive(manifest({ engines: { vscode: "later" } })),
      "1.138.0",
    );
    expect(malformed.metadata.compatibility).toEqual({
      supported: false,
      reason: "invalid-engine-range",
    });
  });

  it.each([
    ["^1.130.0", "1.138.0", true],
    [">=1.120.0 <1.140.0", "1.138.0", true],
    ["1.138", "1.138.9", true],
    ["^0.2", "0.2.9", true],
    ["^0.2", "0.3.0", false],
    [">=1.2", "1.2.9", true],
    [">1.2", "1.3.0", true],
    [">1.2", "1.2.9", false],
    ["<1.2", "1.1.9", true],
    ["<1.2", "1.2.0", false],
    ["<=1.2", "1.2.9", true],
    ["<=1.2", "1.3.0", false],
    ["=1.2", "1.2.9", true],
    ["=1.2", "1.3.0", false],
    [">=1.138.0-insider", "1.138.0", true],
    ["<1.138.0-insider", "1.138.0", false],
    ["=1.138.0-insider", "1.138.0", false],
    ["=1.138.0+marketplace", "1.138.0+runtime", true],
  ])(
    "evaluates semver engine range %s against %s",
    async (range, runtime, supported) => {
      const parsed = await parseEditorVsix(
        archive(manifest({ engines: { vscode: range } })),
        runtime,
      );
      expect(parsed.metadata.compatibility.supported).toBe(supported);
    },
  );

  it("rejects malformed prerelease identifiers", async () => {
    const parsed = await parseEditorVsix(
      archive(manifest({ engines: { vscode: ">=1.138.0-01" } })),
      "1.138.0",
    );
    expect(parsed.metadata.compatibility).toEqual({
      supported: false,
      reason: "invalid-engine-range",
    });
  });

  it.each([
    [
      "desktop-only main entry",
      manifest({ browser: undefined, main: "./dist/extension.js" }),
    ],
    [
      "unsupported contribution point",
      manifest({ contributes: { taskDefinitions: [{ type: "x" }] } }),
    ],
    [
      "unsupported API requirement",
      manifest({ enabledApiProposals: ["terminalShellIntegration"] }),
    ],
  ])(
    "marks %s as unsupported with a stable reason code",
    async (_label, bytes) => {
      const parsed = await parseEditorVsix(
        archive(bytes as Uint8Array),
        "1.138.0",
      );
      expect(parsed.metadata.compatibility).toMatchObject({
        supported: false,
        reason: expect.any(String),
      });
    },
  );

  it("rejects a declared browser resource that is missing from the package", async () => {
    await expect(
      parseEditorVsix(
        archive(manifest({ browser: "./missing.js", main: undefined })),
        "1.138.0",
      ),
    ).rejects.toMatchObject({ code: "missing-browser-resource" });
  });

  it("rejects a declared resource path that traverses outside extension/", async () => {
    await expect(
      parseEditorVsix(
        archive(manifest({ browser: "../outside.js", main: undefined })),
        "1.138.0",
      ),
    ).rejects.toMatchObject({ code: "unsafe-resource-path" });
  });

  it("rejects invalid dependency names before producing metadata", async () => {
    await expect(
      parseEditorVsix(
        archive(manifest({ extensionDependencies: ["Bad Name"] })),
        "1.138.0",
      ),
    ).rejects.toMatchObject({ code: "invalid-dependency" });
  });

  it.each([
    "../escape",
    "/absolute",
    "extension/../escape",
    "extension//double",
    "extension/./alias.txt",
  ])("rejects unsafe archive path %s", async (name) => {
    await expect(
      parseEditorVsix(zip([{ name, data: utf8.encode("bad") }]), "1.138.0"),
    ).rejects.toMatchObject({ code: "unsafe-path" });
  });

  it("rejects a file path that conflicts with a nested entry", async () => {
    await expect(
      parseEditorVsix(
        zip([
          { name: "extension/package.json", data: manifest() },
          {
            name: "extension/dist/extension.js",
            data: utf8.encode("exports.activate = () => {};"),
          },
          { name: "extension/cache", data: utf8.encode("file") },
          { name: "extension/cache/index.js", data: utf8.encode("module") },
        ]),
        "1.138.0",
      ),
    ).rejects.toMatchObject({ code: "path-collision" });
  });

  it("rejects duplicate normalized paths and symbolic links", async () => {
    await expect(
      parseEditorVsix(
        zip([
          { name: "extension/a.txt", data: utf8.encode("one") },
          { name: "extension/a.txt", data: utf8.encode("two") },
        ]),
        "1.138.0",
      ),
    ).rejects.toMatchObject({ code: "duplicate-path" });
    await expect(
      parseEditorVsix(
        zip([
          {
            name: "extension/a.txt",
            data: utf8.encode("target"),
            externalAttributes: (0o120777 << 16) >>> 0,
          },
        ]),
        "1.138.0",
      ),
    ).rejects.toMatchObject({ code: "symlink" });
  });

  it("rejects encrypted, truncated, and checksum-corrupt archives", async () => {
    const encrypted = zip([
      { name: "extension/package.json", data: manifest() },
    ]);
    encrypted[6] |= 1;
    const encryptedCentral = Buffer.from(encrypted).indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    );
    encrypted[encryptedCentral + 8] |= 1;
    await expect(parseEditorVsix(encrypted, "1.138.0")).rejects.toMatchObject({
      code: "encrypted-archive",
    });
    await expect(
      parseEditorVsix(archive().slice(0, -10), "1.138.0"),
    ).rejects.toThrow();
    const corrupt = archive();
    corrupt[30 + "extension/package.json".length] ^= 0x01;
    await expect(parseEditorVsix(corrupt, "1.138.0")).rejects.toMatchObject({
      code: "crc-mismatch",
    });
  });

  it("rejects an invalid deflate stream before accepting package contents", async () => {
    const compressed = archive();
    const firstNameLength = "extension/package.json".length;
    const firstSize = manifest().length;
    const secondHeader = 30 + firstNameLength + firstSize;
    const secondNameLength = "extension/dist/extension.js".length;
    compressed[secondHeader + 30 + secondNameLength] = 0xff;
    await expect(parseEditorVsix(compressed, "1.138.0")).rejects.toMatchObject({
      code: "invalid-deflate-stream",
    });
  });

  it.each(["signed", "unsigned"] as const)(
    "accepts CRC-checked %s ZIP data descriptors",
    async (descriptor) => {
      const parsed = await parseEditorVsix(
        zip([
          {
            name: "extension/package.json",
            data: manifest(),
            descriptor,
          },
          {
            name: "extension/dist/extension.js",
            data: utf8.encode("exports.activate = () => {};"),
            method: 8,
            descriptor,
          },
        ]),
        "1.138.0",
      );
      expect(parsed.metadata.compatibility.supported).toBe(true);
    },
  );

  it("rejects truncated and CRC-mismatched ZIP data descriptors", async () => {
    const truncated = zip([
      {
        name: "extension/package.json",
        data: manifest(),
        descriptor: "truncated",
      },
    ]);
    await expect(parseEditorVsix(truncated, "1.138.0")).rejects.toMatchObject({
      code: "invalid-data-descriptor",
    });

    const corrupt = zip([
      {
        name: "extension/package.json",
        data: manifest(),
        descriptor: "signed",
      },
    ]);
    const descriptorOffset =
      30 + "extension/package.json".length + manifest().length;
    corrupt[descriptorOffset + 4] ^= 1;
    await expect(parseEditorVsix(corrupt, "1.138.0")).rejects.toMatchObject({
      code: "invalid-data-descriptor",
    });
  });

  it("rejects inconsistent directory sizes and invalid UTF-8 names", async () => {
    const inconsistent = archive();
    const centralAt = Buffer.from(inconsistent).indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    );
    inconsistent[centralAt + 24] ^= 1;
    await expect(parseEditorVsix(inconsistent, "1.138.0")).rejects.toThrow();
    const invalidName = zip([
      { name: "extension/\ufffd.txt", data: utf8.encode("x") },
    ]);
    invalidName[30 + "extension/".length] = 0xff;
    const invalidCentral = Buffer.from(invalidName).indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    );
    invalidName[invalidCentral + 46 + "extension/".length] = 0xff;
    await expect(parseEditorVsix(invalidName, "1.138.0")).rejects.toMatchObject(
      { code: "invalid-utf8" },
    );
  });

  it("enforces the compressed package quota at the exact boundary", async () => {
    const atLimit = new Uint8Array(EDITOR_EXTENSION_LIMITS.compressedBytes);
    await expect(parseEditorVsix(atLimit, "1.138.0")).rejects.not.toMatchObject(
      { code: "compressed-size-limit" },
    );
    const overLimit = new Uint8Array(
      EDITOR_EXTENSION_LIMITS.compressedBytes + 1,
    );
    await expect(parseEditorVsix(overLimit, "1.138.0")).rejects.toMatchObject({
      code: "compressed-size-limit",
    });
  });

  it("accepts the exact expanded file quota and rejects one byte over", async () => {
    const file = new Uint8Array(EDITOR_EXTENSION_LIMITS.fileBytes);
    const atLimit = archive(manifest(), [
      { name: "extension/data.bin", data: file, method: 8 },
    ]);
    await expect(parseEditorVsix(atLimit, "1.138.0")).resolves.toBeDefined();
    const overLimit = archive(manifest(), [
      {
        name: "extension/data.bin",
        data: new Uint8Array(file.length + 1),
        method: 8,
      },
    ]);
    await expect(parseEditorVsix(overLimit, "1.138.0")).rejects.toMatchObject({
      code: "file-size-limit",
    });
  });

  it("accepts exactly 64 MiB expanded and rejects one byte over", async () => {
    const packageJson = manifest();
    const browser = utf8.encode("export function activate() {}");
    const repeated = new Uint8Array(EDITOR_EXTENSION_LIMITS.fileBytes);
    const files = Array.from({ length: 7 }, (_, index) => ({
      name: `extension/filler-${index}.bin`,
      data: repeated,
      method: 8 as const,
    }));
    const finalBytes =
      EDITOR_EXTENSION_LIMITS.fileBytes - packageJson.length - browser.length;
    files.push({
      name: "extension/final.bin",
      data: new Uint8Array(finalBytes),
      method: 8,
    });
    const entries = [
      { name: "extension/package.json", data: packageJson, method: 8 as const },
      {
        name: "extension/dist/extension.js",
        data: browser,
        method: 8 as const,
      },
      ...files,
    ];
    await expect(
      parseEditorVsix(zip(entries), "1.138.0"),
    ).resolves.toBeDefined();
    const overLimitEntries = entries.slice();
    overLimitEntries[overLimitEntries.length - 1] = {
      name: "extension/final.bin",
      data: new Uint8Array(finalBytes + 1),
      method: 8,
    };
    await expect(
      parseEditorVsix(zip(overLimitEntries), "1.138.0"),
    ).rejects.toMatchObject({ code: "expanded-size-limit" });
  });

  it("accepts exactly 10,000 files and rejects one additional file", async () => {
    const base = [
      { name: "extension/package.json", data: manifest() },
      {
        name: "extension/dist/extension.js",
        data: utf8.encode("export function activate() {}"),
      },
    ];
    const exact = [
      ...base,
      ...Array.from({ length: 9_998 }, (_, index) => ({
        name: `extension/f${index}`,
        data: new Uint8Array(),
      })),
    ];
    await expect(parseEditorVsix(zip(exact), "1.138.0")).resolves.toBeDefined();
    await expect(
      parseEditorVsix(
        zip([...exact, { name: "extension/extra", data: new Uint8Array() }]),
        "1.138.0",
      ),
    ).rejects.toMatchObject({ code: "file-count-limit" });
  });
});
