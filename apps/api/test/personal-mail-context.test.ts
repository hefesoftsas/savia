import { describe, it, expect } from "vitest";
import { validateMailContext } from "../src/personal-integrations/mail-context";
import { sendPersonalMailSchema } from "@savia/studio-shared/mail-contracts";
const reference = {
  apiBasePath: "/v1/studio/1",
  collection: "contacts",
  recordId: "record-1",
  fields: ["name"],
};
const schema = {
  data: [{ name: "contacts", config: { fields: { name: { type: "Text" } } } }],
};
describe("mail context authorization", () => {
  it("accepts an authorized record and field", async () => {
    await expect(
      validateMailContext([reference], async (path) =>
        Response.json(
          path.endsWith("objects")
            ? schema
            : { data: { id: "record-1", name: "Ana" } },
        ),
      ),
    ).resolves.toBeUndefined();
  });
  it.each([403, 404, 503])("rejects unavailable record %s", async (status) => {
    await expect(
      validateMailContext([reference], async (path) =>
        path.endsWith("objects")
          ? Response.json(schema)
          : new Response(null, { status }),
      ),
    ).rejects.toThrow();
  });
  it("rejects a field hidden by record projection", async () => {
    await expect(
      validateMailContext([reference], async (path) =>
        Response.json(
          path.endsWith("objects") ? schema : { data: { id: "record-1" } },
        ),
      ),
    ).rejects.toThrow();
  });
  it("rejects external and traversal context paths", () => {
    for (const apiBasePath of ["https://evil.test", "/v1/studio/1/../2"])
      expect(
        sendPersonalMailSchema.safeParse({
          provider: "gmail",
          to: ["ana@example.com"],
          subject: "Hi",
          body: "Hello",
          context: [{ ...reference, apiBasePath }],
        }).success,
      ).toBe(false);
  });
  it("rejects header injection and spec limits", () => {
    const valid = {
      provider: "gmail",
      to: ["ana@example.com"],
      subject: "Hi",
      body: "Hello",
    };
    for (const patch of [
      { subject: "Hi\r\nBcc: evil@example.com" },
      { body: "x".repeat(10001) },
      { to: Array(21).fill("ana@example.com") },
      { connectionId: "foreign" },
    ])
      expect(
        sendPersonalMailSchema.safeParse({ ...valid, ...patch }).success,
      ).toBe(false);
    expect(sendPersonalMailSchema.safeParse(valid).success).toBe(true);
  });
});
it("preserves deliberate whitespace in the editable plain-text body", () => {
  const body = "\n  Formatted introduction\n\n";
  expect(
    sendPersonalMailSchema.parse({
      provider: "gmail",
      to: ["ana@example.com"],
      subject: "Hi",
      body,
    }).body,
  ).toBe(body);
  expect(
    sendPersonalMailSchema.safeParse({
      provider: "gmail",
      to: ["ana@example.com"],
      subject: "Hi",
      body: "  \n",
    }).success,
  ).toBe(false);
});
it("rejects dot record IDs that normalize as path traversal", () => {
  for (const recordId of [".", ".."])
    expect(
      sendPersonalMailSchema.safeParse({
        provider: "gmail",
        to: ["ana@example.com"],
        subject: "Hi",
        body: "Hello",
        context: [{ ...reference, recordId }],
      }).success,
    ).toBe(false);
});
