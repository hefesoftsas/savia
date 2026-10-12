import { deflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEditorVsix } from "@savia/studio-shared/plugin-editor-vsix";
import { PLUGIN_EDITOR_VSCODE_VERSION } from "@savia/studio-shared/plugin-editor-extensions";

const mocks = vi.hoisted(() => ({
  registerExtension: vi.fn(),
  getService: vi.fn(),
  ExtensionHostKind: {
    LocalWebWorker: "local-web-worker",
    LocalProcess: "local-process",
  },
}));

vi.mock("@codingame/monaco-vscode-api/extensions", () => ({
  registerExtension: mocks.registerExtension,
  ExtensionHostKind: mocks.ExtensionHostKind,
}));
vi.mock("@codingame/monaco-vscode-api", () => ({
  getService: mocks.getService,
}));
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service",
  () => ({
    IExtensionService: Symbol.for("IExtensionService"),
  }),
);

import { InstalledEditorExtensionManager } from "../plugin-editor-installed-extensions";

const utf8 = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const compressed = entry.name.endsWith(".js")
      ? deflateRawSync(entry.data)
      : Buffer.from(entry.data);
    const method = entry.name.endsWith(".js") ? 8 : 0;
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    Buffer.from(name).copy(header, 30);
    local.push(header, compressed);
    const index = Buffer.alloc(46 + name.length);
    index.writeUInt32LE(0x02014b50, 0);
    index.writeUInt16LE(0x031e, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt16LE(method, 10);
    index.writeUInt32LE(crc, 16);
    index.writeUInt32LE(compressed.length, 20);
    index.writeUInt32LE(entry.data.length, 24);
    index.writeUInt16LE(name.length, 28);
    index.writeUInt32LE(offset, 42);
    Buffer.from(name).copy(index, 46);
    central.push(index);
    offset += header.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

function packageBytes(
  options: {
    publisher?: string;
    name?: string;
    version?: string;
    dependencies?: string[];
    source?: string;
  } = {},
): Uint8Array {
  const publisher = options.publisher ?? "acme";
  const name = options.name ?? "browser-tools";
  const manifest = utf8.encode(
    JSON.stringify({
      publisher,
      name,
      version: options.version ?? "1.0.0",
      engines: { vscode: "^1.130.0" },
      browser: "./dist/extension.js",
      main: "./dist/extension.js",
      extensionDependencies: options.dependencies ?? [],
    }),
  );
  return zip([
    { name: "extension/package.json", data: manifest },
    {
      name: "extension/dist/extension.js",
      data: utf8.encode(
        options.source ??
          "const vscode = require('vscode'); exports.activate = () => {};",
      ),
    },
  ]);
}

const service = {
  activateById: vi.fn(async () => undefined),
  activateByEvent: vi.fn(async () => undefined),
  getExtensionsStatus: vi.fn(() => ({})),
  stopExtensionHosts: vi.fn(async () => true),
  startExtensionHosts: vi.fn(async () => undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  service.activateById.mockResolvedValue(undefined);
  service.activateByEvent.mockResolvedValue(undefined);
  service.getExtensionsStatus.mockReturnValue(
    new Proxy({}, { get: () => ({ activationTimes: {}, runtimeErrors: [] }) }),
  );
  service.stopExtensionHosts.mockResolvedValue(true);
  service.startExtensionHosts.mockResolvedValue(undefined);
  mocks.getService.mockResolvedValue(service);
  mocks.registerExtension.mockImplementation(() => ({
    dispose: vi.fn(async () => undefined),
    registerFileUrl: vi.fn(() => ({ dispose: vi.fn() })),
    whenReady: vi.fn(async () => undefined),
  }));
});

async function prepare(
  manager: InstalledEditorExtensionManager,
  installationId: string,
  bytes: Uint8Array,
  sha256Override?: string,
) {
  const parsed = await parseEditorVsix(bytes, PLUGIN_EDITOR_VSCODE_VERSION);
  await manager.receive(
    installationId,
    sha256Override ?? parsed.metadata.sha256,
    bytes,
  );
  return { installationId, sha256: parsed.metadata.sha256 };
}

describe("InstalledEditorExtensionManager", () => {
  it("registers browser code with the isolated LocalWebWorker host and activates that exact extension", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const reference = await prepare(manager, "install-browser", packageBytes());

    await manager.enable(reference);

    expect(mocks.registerExtension).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "browser-tools",
        browser: "./dist/extension.js",
      }),
      mocks.ExtensionHostKind.LocalWebWorker,
    );
    expect(service.activateById).toHaveBeenCalledWith(
      expect.objectContaining({ value: "acme.browser-tools" }),
      expect.objectContaining({
        startup: false,
        extensionId: expect.objectContaining({ value: "acme.browser-tools" }),
      }),
    );
    expect(service.activateByEvent).not.toHaveBeenCalled();
    await manager.dispose();
  });

  it("stops a stalled activation and rejects without leaving its registration enabled", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const reference = await prepare(manager, "install-browser", packageBytes());
    service.activateById.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const activation = expect(manager.enable(reference)).rejects.toThrow(
        /timed out/,
      );
      await vi.advanceTimersByTimeAsync(10000);
      await activation;
      expect(service.stopExtensionHosts).toHaveBeenCalled();
      expect(
        mocks.registerExtension.mock.results[0].value.dispose,
      ).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    await manager.dispose();
  });

  it("allows restoring a removed registration after retained-host restart fails", async () => {
    const restarted = vi.fn(async () => {});
    const manager = new InstalledEditorExtensionManager(true, restarted);
    const ref = await prepare(manager, "install-browser", packageBytes());
    await manager.enable(ref);
    restarted.mockRejectedValueOnce(new Error("Restart failed"));
    await expect(manager.disable(ref.installationId)).rejects.toThrow(
      "Restart failed",
    );
    await manager.enable(ref);
    expect(mocks.registerExtension).toHaveBeenCalledTimes(2);
    await manager.dispose();
  });
  it("rejects a package digest mismatch", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    await expect(
      manager.receive("install-browser", "f".repeat(64), packageBytes()),
    ).rejects.toThrow(/digest/i);
    expect(mocks.registerExtension).not.toHaveBeenCalled();
  });

  it("denies third-party packages when the manager is not isolated", async () => {
    const manager = new InstalledEditorExtensionManager(false);
    await expect(
      manager.receive("install-browser", "a".repeat(64), new Uint8Array()),
    ).rejects.toThrow(/isolated editor host/i);
    expect(mocks.registerExtension).not.toHaveBeenCalled();
  });

  it("reports a missing enabled dependency before registering the package", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const reference = await prepare(
      manager,
      "install-browser",
      packageBytes({ dependencies: ["acme.dependency"] }),
    );

    await expect(manager.enable(reference)).rejects.toThrow(
      /missing enabled dependency: acme\.dependency/i,
    );
    expect(mocks.registerExtension).not.toHaveBeenCalled();
    await manager.dispose();
  });

  it("rejects dependency cycles during project synchronization", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const first = await prepare(
      manager,
      "install-first",
      packageBytes({ name: "first", dependencies: ["acme.second"] }),
    );
    const second = await prepare(
      manager,
      "install-second",
      packageBytes({ name: "second", dependencies: ["acme.first"] }),
    );

    await expect(manager.synchronize([first, second])).rejects.toThrow(
      /missing or circular dependencies/i,
    );
    expect(mocks.registerExtension).not.toHaveBeenCalled();
    await manager.dispose();
  });

  it("disposes registrations and revokes package URLs when disabled", async () => {
    const order: string[] = [];
    const onHostRestarted = vi.fn(async () => {
      order.push("restart-callback");
    });
    const manager = new InstalledEditorExtensionManager(true, onHostRestarted);
    const reference = await prepare(manager, "install-browser", packageBytes());
    const revocations: string[] = [];
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob) => `blob:extension-${blob.size}`);
    const revokeUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation((url) => {
        revocations.push(url);
      });
    service.stopExtensionHosts.mockImplementation(async () => {
      order.push("stop");
      return true;
    });
    service.startExtensionHosts.mockImplementation(async () => {
      order.push("start");
    });
    mocks.registerExtension.mockImplementation(() => ({
      dispose: vi.fn(async () => {
        order.push("dispose-registration");
      }),
      registerFileUrl: vi.fn(() => ({ dispose: vi.fn() })),
      whenReady: vi.fn(async () => undefined),
    }));

    await manager.enable(reference);
    const registered = mocks.registerExtension.mock.results[0].value;
    const fileRegistration = registered.registerFileUrl.mock.results[0].value;
    await manager.disable(reference.installationId);

    expect(fileRegistration.dispose).toHaveBeenCalledOnce();
    expect(registered.dispose).toHaveBeenCalledOnce();
    expect(revocations).toHaveLength(2);
    expect(service.stopExtensionHosts).toHaveBeenCalledWith(
      expect.any(String),
      true,
    );
    expect(order).toEqual([
      "stop",
      "dispose-registration",
      "start",
      "restart-callback",
    ]);
    expect(onHostRestarted).toHaveBeenCalledOnce();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    await manager.dispose();
  });

  it("keeps a registration intact when the extension host refuses to stop", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const reference = await prepare(manager, "install-browser", packageBytes());
    await manager.enable(reference);
    const registered = mocks.registerExtension.mock.results[0].value;
    service.stopExtensionHosts.mockResolvedValue(false);

    await expect(manager.disable(reference.installationId)).rejects.toThrow(
      /refused to stop|veto/i,
    );
    await manager.enable(reference);

    expect(registered.dispose).not.toHaveBeenCalled();
    expect(mocks.registerExtension).toHaveBeenCalledOnce();
    expect(service.startExtensionHosts).not.toHaveBeenCalled();
    service.stopExtensionHosts.mockResolvedValue(true);
    await manager.dispose();
  });

  it("reactivates retained installed providers after restarting shared extension hosts", async () => {
    const onHostRestarted = vi.fn(async () => undefined);
    const manager = new InstalledEditorExtensionManager(true, onHostRestarted);
    const retainedBytes = packageBytes({ name: "retained" });
    const removedBytes = packageBytes({ name: "removed" });
    const retained = await prepare(manager, "install-retained", retainedBytes);
    const removed = await prepare(manager, "install-removed", removedBytes);
    const order: string[] = [];
    service.activateById.mockImplementation(async (identifier) => {
      const id = (identifier as { value: string }).value;
      order.push(`activate:${id}`);
    });
    service.stopExtensionHosts.mockImplementation(async () => {
      order.push("stop");
      return true;
    });
    service.startExtensionHosts.mockImplementation(async () => {
      order.push("start");
    });
    onHostRestarted.mockImplementation(async () => {
      order.push("restart-callback");
    });
    await manager.enable(retained);
    await manager.enable(removed);

    await manager.disable(removed.installationId);

    expect(order.slice(-4)).toEqual([
      "stop",
      "start",
      "restart-callback",
      "activate:acme.retained",
    ]);
    expect(service.activateById).toHaveBeenCalledTimes(3);
    await manager.dispose();
  });

  it("restores the previous version after an update activation fails without changing editor models", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const priorBytes = packageBytes({ version: "1.0.0" });
    const candidateBytes = packageBytes({ version: "2.0.0" });
    const prior = await prepare(manager, "install-prior", priorBytes);
    const candidate = await prepare(
      manager,
      "install-candidate",
      candidateBytes,
    );
    const models = new Map([["main.ts", "unsaved editor content"]]);
    mocks.registerExtension.mockImplementation(
      (manifest: { version: string }) => ({
        dispose: vi.fn(async () => undefined),
        registerFileUrl: vi.fn(() => ({ dispose: vi.fn() })),
        whenReady: vi.fn(async () => {
          if (manifest.version === "2.0.0")
            throw new Error("candidate activation failed");
        }),
      }),
    );
    await manager.enable(prior);

    await expect(manager.enable(candidate)).rejects.toThrow(
      "candidate activation failed",
    );
    expect(service.stopExtensionHosts).toHaveBeenCalledTimes(2);
    const registrationCountAfterRollback =
      mocks.registerExtension.mock.calls.length;
    await manager.enable(prior);

    expect(registrationCountAfterRollback).toBe(3);
    expect(mocks.registerExtension).toHaveBeenCalledTimes(3);
    expect(models.get("main.ts")).toBe("unsaved editor content");
    await manager.dispose();
  });

  it("surfaces runtime activation errors instead of recording the extension as active", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const reference = await prepare(manager, "install-browser", packageBytes());
    service.getExtensionsStatus.mockReturnValue({
      "acme.browser-tools": {
        activationTimes: {},
        runtimeErrors: [new Error("provider crashed")],
      },
    });

    await expect(manager.enable(reference)).rejects.toThrow("provider crashed");
    expect(
      mocks.registerExtension.mock.results[0].value.dispose,
    ).toHaveBeenCalledOnce();
    await manager.dispose();
  });

  it("rejects activateById calls that never acquire activation times", async () => {
    const manager = new InstalledEditorExtensionManager(true);
    const reference = await prepare(
      manager,
      "install-not-activated",
      packageBytes(),
    );
    service.getExtensionsStatus.mockReturnValue({
      "acme.browser-tools": {
        activationStarted: false,
        activationTimes: undefined,
        runtimeErrors: [],
      },
    });

    await expect(manager.enable(reference)).rejects.toThrow(/activation/i);
    expect(
      mocks.registerExtension.mock.results[0].value.dispose,
    ).toHaveBeenCalledOnce();
    await manager.dispose();
  });
});
