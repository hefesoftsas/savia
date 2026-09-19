import { describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  applyClientRecord,
  buildClientRecord,
  defaultClientMapping,
  fetchClientByMatch,
  matchSourceKey,
  resolveApplicantValue,
  upsertQuoteClient,
} from "../src/client-mapping";
import { defaultQuoteFormValues } from "../src/screens/quote-input";

const applicant = {
  ...defaultQuoteFormValues.applicant,
  documentType: "CC",
  documentNumber: "12345678",
  firstName: "Ana",
  surname: "López",
  secondSurname: "Pérez",
  phone: "3001234567",
  email: "ana@example.test",
};

function mockSavia(records: Array<Record<string, unknown>> = []) {
  const store = [...records];
  return {
    savia: {
      collections: {
        collection: () => ({
          list: vi.fn(async ({ page = 1, perPage = 200 }: any = {}) => ({
            data: store.slice((page - 1) * perPage, page * perPage),
            total: store.length,
            page,
            perPage,
          })),
          create: vi.fn(async (input: Record<string, unknown>) => {
            const record = { id: `clientes-${store.length + 1}`, ...input };
            store.push(record);
            return record;
          }),
          update: vi.fn(async (id: string, input: Record<string, unknown>) => {
            const index = store.findIndex((item) => item.id === id);
            const updated = { ...store[index], ...input };
            if (index >= 0) store[index] = updated;
            return updated;
          }),
        }),
      },
    } as unknown as PluginApi,
    store,
  };
}

describe("client mapping", () => {
  it("resolves the full name from its parts", () => {
    expect(resolveApplicantValue(applicant, "fullName")).toBe(
      "Ana López Pérez",
    );
    expect(resolveApplicantValue(applicant, "documentNumber")).toBe(
      "12345678",
    );
  });

  it("builds a Clientes record from the default mapping", () => {
    expect(buildClientRecord(applicant, defaultClientMapping)).toEqual({
      name: "Ana López Pérez",
      documento: "12345678",
      email: "ana@example.test",
      telefono: "3001234567",
    });
  });

  it("supports mapping to a different collection with custom fields", () => {
    const record = buildClientRecord(applicant, {
      collection: "prospectos",
      matchField: "email",
      fieldMap: { nombre: "firstName", correo: "email" },
    });
    expect(record).toEqual({ nombre: "Ana", correo: "ana@example.test" });
  });

  it("creates the client when there is no match", async () => {
    const { savia, store } = mockSavia();
    const result = await upsertQuoteClient(
      savia,
      { clientMapping: defaultClientMapping },
      applicant,
    );
    expect(result).toMatchObject({ created: true });
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ documento: "12345678" });
  });

  it("updates the existing client instead of duplicating it", async () => {
    const { savia, store } = mockSavia([
      { id: "clientes-9", documento: "12345678", name: "Ana Vieja" },
    ]);
    const result = await upsertQuoteClient(
      savia,
      { clientMapping: defaultClientMapping },
      applicant,
    );
    expect(result).toEqual({ id: "clientes-9", created: false });
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ name: "Ana López Pérez" });
  });

  it("never throws and returns null without blocking the quote", async () => {
    const savia = {
      collections: {
        collection: () => ({
          list: vi.fn(async () => {
            throw new Error("CRM caído");
          }),
        }),
      },
    } as unknown as PluginApi;
    await expect(
      upsertQuoteClient(savia, { clientMapping: defaultClientMapping }, applicant),
    ).resolves.toBeNull();
    await expect(
      upsertQuoteClient(savia, { clientMapping: null }, applicant),
    ).resolves.toBeNull();
  });

  it("exposes the applicant source behind the match field", () => {
    expect(matchSourceKey(defaultClientMapping)).toBe("documentNumber");
    expect(
      matchSourceKey({ ...defaultClientMapping, matchField: "inexistente" }),
    ).toBeNull();
  });

  it("fetches an existing client by the match value", async () => {
    const { savia } = mockSavia([
      { id: "clientes-9", documento: "12345678", name: "Ana López Pérez" },
    ]);
    await expect(
      fetchClientByMatch(savia, defaultClientMapping, "12345678"),
    ).resolves.toMatchObject({ id: "clientes-9" });
    await expect(
      fetchClientByMatch(savia, defaultClientMapping, "00000000"),
    ).resolves.toBeNull();
  });

  it("loads the existing client into empty form fields without erasing input", () => {
    const empty = {
      ...defaultQuoteFormValues.applicant,
      documentNumber: "12345678",
      firstName: "An",
    };
    const { applicant: loaded, filled } = applyClientRecord(
      empty,
      {
        name: "Ana López Pérez",
        documento: "12345678",
        email: "ana@example.test",
        telefono: "3001234567",
      },
      defaultClientMapping,
    );
    expect(loaded.firstName).toBe("An");
    expect(loaded.surname).toBe("López");
    expect(loaded.secondSurname).toBe("Pérez");
    expect(loaded.email).toBe("ana@example.test");
    expect(loaded.phone).toBe("3001234567");
    expect(filled).toEqual(
      expect.arrayContaining(["surname", "secondSurname", "email", "phone"]),
    );
    expect(filled).not.toContain("firstName");
  });
});
