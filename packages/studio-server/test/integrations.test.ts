import { describe, it, expect, vi } from "vitest";
import {
  inspectDocument,
  schemaToObject,
  validateJsonSchema,
  materializeSchema,
} from "@savia/studio-shared/openapi";
import {
  publicUrl,
  isPublicAddress,
  validatePublicDns,
  encryptSecret,
  decryptSecret,
  boundedText,
} from "../src/integrations";
import { objectSchema, validateRecord } from "@savia/studio-shared/metadata";
import { exampleOpenApi } from "@savia/studio-shared/seed";
const composite = {
  allOf: [
    {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", minLength: 2 } },
    },
    {
      type: "object",
      required: ["payload"],
      properties: {
        payload: {
          type: "object",
          required: ["items"],
          additionalProperties: false,
          properties: {
            items: {
              type: "array",
              minItems: 1,
              items: {
                oneOf: [
                  { type: "integer", minimum: 1 },
                  { type: "string", enum: ["pending"] },
                ],
              },
            },
          },
        },
      },
    },
  ],
};
describe("OpenAPI operational support", () => {
  it("imports allOf and validates nested union arrays without dropping data", () => {
    const object = schemaToObject({}, composite, "response");
    expect(objectSchema.safeParse(object).success).toBe(true);
    expect(object.config.fields.payload.type).toBe("Textarea");
    expect(
      validateRecord(object, { code: "ok", payload: '{"items":[1,"pending"]}' })
        .errors,
    ).toEqual({});
    expect(
      validateRecord(object, { code: "ok", payload: '{"items":[0]}' }).errors
        .payload,
    ).toBeTruthy();
    expect(
      validateJsonSchema({}, composite, { code: "a", payload: { items: [] } }),
    ).toHaveLength(2);
  });
  it("detects refs in parameters and merges path-level parameters with overrides", () => {
    const doc = {
      openapi: "3.1.0",
      paths: {
        "/quotes/{id}": {
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          get: {
            operationId: "lookup",
            parameters: [{ $ref: "#/components/parameters/Limit" }],
            responses: { 200: { description: "OK" } },
          },
        },
      },
      components: {
        parameters: {
          Limit: {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 20 },
          },
        },
      },
    };
    const op = inspectDocument(doc).operations[0];
    expect(op.parameters.map((p) => p.name)).toEqual(["id", "limit"]);
    expect(op.error).toBeUndefined();
  });
  it("fails closed on remote refs, cycles, unsupported schema semantics and oversized contracts", () => {
    expect(() =>
      materializeSchema({}, { $ref: "https://example.net/schema" }),
    ).toThrow("locales");
    const doc = {
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { child: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    };
    expect(() => materializeSchema(doc, doc.components.schemas.Node)).toThrow(
      "circulares",
    );
    expect(() =>
      materializeSchema(
        {},
        { type: "object", if: { required: ["x"] }, then: { required: ["y"] } },
      ),
    ).toThrow("no admite");
    expect(() => inspectDocument(" ".repeat(1024 * 1024 + 1))).toThrow("1 MB");
  });
  it("enforces exclusive bounds, unique arrays and oneOf ambiguity", () => {
    expect(
      validateJsonSchema({}, { type: "number", exclusiveMinimum: 1 }, 1),
    ).not.toEqual([]);
    expect(
      validateJsonSchema({}, { type: "array", uniqueItems: true }, [1, 1]),
    ).not.toEqual([]);
    expect(
      validateJsonSchema(
        {},
        { oneOf: [{ type: "number" }, { type: "integer" }] },
        1,
      ),
    ).not.toEqual([]);
  });
  it("retains numeric enums as a scalar validation schema and valid date field metadata", () => {
    const object = schemaToObject(
      {},
      {
        type: "object",
        properties: {
          date: { type: "string", format: "date" },
          level: { type: "integer", enum: [1, 3] },
        },
      },
      "setting",
    );
    expect(objectSchema.safeParse(object).success).toBe(true);
    expect(object.config.fields.level.config?.validationSchema).toEqual({
      type: "integer",
      enum: [1, 3],
    });
  });
  it("keeps the local quote form contract", () => {
    expect(
      inspectDocument(exampleOpenApi).operations[0].object?.config.fields.seats
        .type,
    ).toBe("Number");
  });
});
describe("Outbound integration boundaries", () => {
  it("blocks private, mapped, numeric and credential URLs", () => {
    for (const url of [
      "http://api.github.com",
      "https://127.0.0.1",
      "https://2130706433",
      "https://0x7f000001",
      "https://[::1]",
      "https://localhost",
      "https://service.internal",
      "https://user:secret@api.github.com",
      "https://api.github.com:8443",
      "https://api.github.com/#fragment",
    ])
      expect(() => publicUrl(url)).toThrow();
    expect(publicUrl("https://api.github.com/v1").hostname).toBe(
      "api.github.com",
    );
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "100.64.0.1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "2002:7f00:1::",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
  });
  it("rejects a public-looking domain when any DNS answer is private", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ Status: 0, Answer: [{ type: 1, data: "127.0.0.1" }] }),
    );
    await expect(
      validatePublicDns(
        publicUrl("https://api.github.com"),
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("públicas");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("encrypts secrets with context-bound authenticated encryption", async () => {
    const key = "a".repeat(40),
      secret = "test-token-not-for-production";
    const encrypted = await encryptSecret(secret, key, "demo:one");
    expect(encrypted).not.toContain(secret);
    expect(await decryptSecret(encrypted, key, "demo:one")).toBe(secret);
    await expect(decryptSecret(encrypted, key, "demo:other")).rejects.toThrow(
      "descifrar",
    );
  });
  it("limits streaming responses even without Content-Length", async () => {
    await expect(boundedText(new Response("abcdef"), 4)).rejects.toThrow(
      "1 MB",
    );
  });
});
