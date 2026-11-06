import { describe, expect, it, vi } from "vitest";
import { EditorExtensionTransferReceiver } from "../plugin-editor-extension-transfer";

describe("extension package transfer", () => {
  it("requires ordered bounded chunks and an exact complete length", () => {
    const receiver = new EditorExtensionTransferReceiver();
    receiver.accept({
      type: "begin",
      id: "a",
      installationId: "installation",
      sha256: "a".repeat(64),
      size: 3,
    });
    expect(() =>
      receiver.accept({
        type: "chunk",
        id: "a",
        offset: 1,
        bytes: new Uint8Array([1]),
      }),
    ).toThrow();
    receiver.accept({
      type: "begin",
      id: "b",
      installationId: "installation",
      sha256: "a".repeat(64),
      size: 3,
    });
    receiver.accept({
      type: "chunk",
      id: "b",
      offset: 0,
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(receiver.accept({ type: "end", id: "b" })?.bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(() =>
      receiver.accept({
        type: "begin",
        id: "huge",
        size: 20 * 1024 * 1024 + 1,
      }),
    ).toThrow();
  });
  it("releases a stalled buffer on its deadline even without another message", async () => {
    vi.useFakeTimers();
    try {
      const receiver = new EditorExtensionTransferReceiver();
      receiver.accept({
        type: "begin",
        id: "stalled",
        installationId: "installation",
        sha256: "a".repeat(64),
        size: 20 * 1024 * 1024,
      });
      await vi.advanceTimersByTimeAsync(60000);
      expect(() => receiver.accept({ type: "end", id: "stalled" })).toThrow(
        /expired/,
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("discards partial data when a project session ends", () => {
    const receiver = new EditorExtensionTransferReceiver();
    receiver.accept({
      type: "begin",
      id: "a",
      installationId: "installation",
      sha256: "a".repeat(64),
      size: 3,
    });
    receiver.clear();
    expect(() => receiver.accept({ type: "end", id: "a" })).toThrow();
  });
});
