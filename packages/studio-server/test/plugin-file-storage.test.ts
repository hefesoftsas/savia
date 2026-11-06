import { describe, expect, it } from "vitest";
import {
  encodePluginFilesJson,
  decodePluginFilesJson,
} from "../src/plugin-file-storage";

describe("plugin file storage", () => {
  it("keeps existing small JSON records readable", async () => {
    const json = JSON.stringify({ "entry.tsx": "export function render() {}" });
    expect(await encodePluginFilesJson(json)).toBe(json);
    expect(await decodePluginFilesJson(json)).toBe(json);
  });
  it("losslessly compresses source-rich records below the D1 row limit", async () => {
    const json = JSON.stringify({
      "entry.tsx": "// código fuente 🪴\n".repeat(150000),
    });
    const stored = await encodePluginFilesJson(json);
    expect(new TextEncoder().encode(stored).length).toBeLessThan(1800000);
    expect(JSON.parse(stored).format).toBe("savia.plugin-files.gzip.v1");
    expect(await decodePluginFilesJson(stored)).toBe(json);
  });
  it("rejects damaged compressed records", async () => {
    await expect(
      decodePluginFilesJson(
        JSON.stringify({
          format: "savia.plugin-files.gzip.v1",
          data: "broken",
        }),
      ),
    ).rejects.toThrow();
  });
  it("bounds expansion of compressed records", async () => {
    const stream = new Blob(["x".repeat(31 * 1024 * 1024)])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    await expect(
      decodePluginFilesJson(
        JSON.stringify({
          format: "savia.plugin-files.gzip.v1",
          data: btoa(binary),
        }),
      ),
    ).rejects.toThrow("Expanded plugin source exceeds");
  });
});
