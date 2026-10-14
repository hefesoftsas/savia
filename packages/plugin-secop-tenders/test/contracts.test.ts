import { describe, expect, it } from "vitest";
import manifest from "../savia-extension.json";
import store from "../store.json";
import { extensionManifestSchema } from "../../studio-shared/src/extension-package";
import { storeJsonSchema } from "../../studio-shared/src/plugin-store";

describe("SECOP plugin package contracts", () => {
  it("accepts the localized extension manifest and store declarations", () => {
    expect(extensionManifestSchema.safeParse(manifest).success).toBe(true);
    expect(storeJsonSchema.safeParse(store).success).toBe(true);
  });
});
