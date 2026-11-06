import { describe, expect, it } from "vitest";
import {
  localPluginDescriptorSchema,
  pluginCheckoutSchema,
  pluginPublicationRequestSchema,
  pluginPublicationReceiptSchema,
} from "../src/plugin-development";
const sha = "a".repeat(64);
const head = { version: "1.0.0", sha256: sha };
const publication = {
  mode: "create",
  destination: "tenant",
  pluginId: "custom.example",
  version: "1.1.0",
  sourceVersion: "1.0.0",
  sourceSha256: sha,
  expectedHead: head,
};
const descriptor = {
  schemaVersion: 1,
  origin: "https://savia.test",
  tenantId: 12,
  pluginId: "custom.example",
  sourceVersion: "1.0.0",
  sourceSha256: sha,
  expectedHead: head,
  entryPath: "entry.tsx",
};
describe("plugin development contracts", () => {
  it("requires the selected source identity as well as an expected head", () => {
    expect(pluginPublicationRequestSchema.parse(publication)).toEqual(
      publication,
    );
    for (const field of ["sourceVersion", "sourceSha256", "expectedHead"]) {
      const input = { ...publication };
      delete (input as any)[field];
      expect(pluginPublicationRequestSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });
  it("rejects malformed coordinates, digests, modes and targets", () => {
    for (const patch of [
      { version: "latest" },
      { version: "01.1.0" },
      { sourceSha256: "abc" },
      { expectedHead: { ...head, sha256: "A".repeat(64) } },
      { destination: "production" },
      { mode: "activate" },
      { pluginId: "../bad" },
    ])
      expect(
        pluginPublicationRequestSchema.safeParse({ ...publication, ...patch })
          .success,
      ).toBe(false);
  });
  it("forbids descriptor credentials, extra fields and non-origin endpoints", () => {
    expect(localPluginDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    for (const patch of [
      { token: "secret" },
      { password: "secret" },
      { unknown: 1 },
      { origin: "https://savia.test/path" },
      { origin: "https://user:pass@savia.test" },
      { origin: "http://external.test" },
      { entryPath: "../entry.tsx" },
    ])
      expect(
        localPluginDescriptorSchema.safeParse({ ...descriptor, ...patch })
          .success,
      ).toBe(false);
    expect(
      localPluginDescriptorSchema.safeParse({
        ...descriptor,
        origin: "http://localhost:8787",
      }).success,
    ).toBe(true);
  });
  it("does not claim shared success without a shared release receipt", () => {
    const local = { pluginId: "custom.example", ...head };
    expect(
      pluginPublicationReceiptSchema.safeParse({
        state: "shared-pending",
        destination: "shared",
        local,
        head,
        sharedHead: null,
        issues: [
          { code: "REGISTRY_UNAVAILABLE", message: "Registry unavailable" },
        ],
      }).success,
    ).toBe(true);
    expect(
      pluginPublicationReceiptSchema.safeParse({
        state: "published",
        destination: "shared",
        local,
        head,
        sharedHead: null,
        issues: [],
      }).success,
    ).toBe(false);
  });
  it("requires checkout files and selected source provenance", () => {
    expect(
      pluginCheckoutSchema.safeParse({
        pluginId: "custom.example",
        sourceVersion: "1.0.0",
        head,
      }).success,
    ).toBe(false);
  });
});
