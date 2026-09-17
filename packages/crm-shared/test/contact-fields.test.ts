import { describe, expect, it } from "vitest";
import {
  makeConfig,
  objectSchema,
  validateRecord,
  type CrmObject,
} from "../src/metadata";

const object: CrmObject = {
  name: "contact",
  label: "Contacto",
  description: "",
  config: makeConfig({
    email: { type: "Email", label: "Correo", required: true },
    phone: { type: "Phone", label: "Teléfono" },
    website: { type: "Url", label: "Página web" },
    address: { type: "Address", label: "Dirección" },
  }),
};

describe("contact field types", () => {
  it("validates email, phone, url and address values", () => {
    expect(
      validateRecord(object, {
        email: "not-an-email",
        phone: "abc",
        website: "ftp://example.com",
        address: "Calle 123",
      }).errors,
    ).toEqual(
      expect.objectContaining({
        email: expect.any(String),
        phone: expect.any(String),
        website: expect.any(String),
      }),
    );
    expect(
      validateRecord(object, {
        email: "demo@example.com",
        phone: "+57 300 123 4567",
        website: "https://example.com",
        address: "Carrera 7 # 45-67",
      }).errors,
    ).toEqual({});
  });

  it("rejects redundant format config on dedicated contact types", () => {
    expect(
      objectSchema.safeParse({
        ...object,
        config: makeConfig({
          email: {
            type: "Email",
            label: "Correo",
            config: { format: "email" },
          },
        }),
      }).success,
    ).toBe(false);
  });

  it("rejects address autocomplete outside Address fields", () => {
    expect(
      objectSchema.safeParse({
        ...object,
        config: makeConfig({
          notes: {
            type: "Textbox",
            label: "Notas",
            config: { addressAutocomplete: true },
          },
        }),
      }).success,
    ).toBe(false);
  });
});
