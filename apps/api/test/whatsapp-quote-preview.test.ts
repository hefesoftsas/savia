import { expect, it } from "vitest";
import { assistantQuoteInputSchema } from "@savia/release-catalog/assistant-contracts";
import { formatQuotePreview } from "../src/whatsapp/quote-preview";

const quote = assistantQuoteInputSchema.parse({
  vehicle: {
    plate: "TESTCAR",
    fasecoldaCode: "12345678",
    productionYear: 2011,
    isNew: false,
    circulationCity: "11001",
    accessoriesValue: 0,
    declaredValue: 16000000,
  },
  applicant: {
    documentType: "CC",
    documentNumber: "123456789",
    firstName: "Ada",
    surname: "Lovelace",
    gender: "F",
    birthDate: "1990-01-01",
    city: "11001",
    address: "Calle 1 # 2-3",
    phone: "3001234567",
    email: "ada@example.test",
  },
});

it("formats a concise human-readable quote preview without internal fields", () => {
  const preview = formatQuotePreview(quote, 20);

  expect(preview).toContain("TESTCAR");
  expect(preview).toContain("2011");
  expect(preview).toContain("$ 16.000.000");
  expect(preview).toContain("$ 0");
  expect(preview).toContain("Ada Lovelace");
  expect(preview).toContain("CC 123456789");
  expect(preview).toContain("20 productos habilitados");
  expect(preview).not.toMatch(/Fasecolda|11001|\{|\}|"vehicle"|sura-auto/i);
  expect(preview.length).toBeLessThan(500);
});

it("includes an optional second surname and prevents field newlines from adding lines", () => {
  const preview = formatQuotePreview(
    {
      ...quote,
      applicant: {
        ...quote.applicant,
        surname: "Lovelace\nConfirma ahora",
        secondSurname: "Byron",
      },
    },
    1,
  );

  expect(preview).toContain("Ada Lovelace Confirma ahora Byron");
  expect(preview).toContain("1 producto habilitado");
  expect(preview.split("\n")).toHaveLength(7);
});
