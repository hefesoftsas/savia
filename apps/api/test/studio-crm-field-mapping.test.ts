import { expect, it, vi } from "vitest";
import { studioWorkspaceAdapter } from "../src/external-crm/studio-workspace-adapter";
const conn = { id: "connection", externalAccountId: "account" } as any;
function adapter(fields: Record<string, unknown>) {
  return {
    resources: [],
    describe: async () => ({
      fields,
      title: "LastName",
      capabilities: { read: true },
    }),
    create: vi.fn(async (_c, _r, data) => ({ id: "123", ...data })),
    list: vi.fn(async () => ({
      records: [{ id: "123", LastName: "Ada", "1abc": "Value" }],
      hasNextPage: false,
    })),
  } as any;
}
it("roundtrips native field case and custom digit-leading keys without changing remote identifiers", async () => {
  const native = adapter({
    Id: { type: "Textbox", label: "ID", readOnly: true },
    LastName: { type: "Textbox", label: "Last name" },
    "1abc": { type: "Textbox", label: "Custom" },
  });
  const wrapped = studioWorkspaceAdapter(native);
  const description = await wrapped.describe(conn, "contacts");
  expect(Object.keys(description.fields)).toEqual(["lastname", "crm_1abc"]);
  expect(description.title).toBe("lastname");
  const result = await wrapped.create(conn, "contacts", {
    lastname: "Ada",
    crm_1abc: "Value",
  });
  expect(result).toMatchObject({
    id: "123",
    lastname: "Ada",
    crm_1abc: "Value",
  });
  expect(native.create).toHaveBeenCalledWith(conn, "contacts", {
    LastName: "Ada",
    "1abc": "Value",
  });
  const listed = await wrapped.list(conn, "contacts", {
    page: 1,
    perPage: 25,
    fields: ["lastname", "crm_1abc"],
  });
  expect(listed.records[0]).toMatchObject({
    lastname: "Ada",
    crm_1abc: "Value",
  });
  expect(native.list.mock.calls[0][2].fields).toEqual(["LastName", "1abc"]);
});
it("rejects native identifiers that collide in Studio instead of redirecting fields", async () => {
  const native = adapter({
    Name: { type: "Textbox", label: "First" },
    name: { type: "Textbox", label: "Second" },
  });
  await expect(
    studioWorkspaceAdapter(native).describe(conn, "contacts"),
  ).rejects.toThrow("cannot be represented safely");
});
it("rejects unknown local fields before sending a remote write", async () => {
  const native = adapter({ LastName: { type: "Textbox", label: "Name" } });
  await expect(
    studioWorkspaceAdapter(native).create(conn, "contacts", { unknown: "No" }),
  ).rejects.toThrow("Unknown CRM field");
  expect(native.create).not.toHaveBeenCalled();
});
