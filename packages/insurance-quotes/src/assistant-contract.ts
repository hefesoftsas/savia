import { z } from "zod";
import { validateQuote, type QuoteFormValues } from "./screens/quote-input";

const text = z.string().trim().min(1).max(200);
export const assistantQuoteInputSchema = z
  .object({
    vehicle: z
      .object({
        plate: text.transform((v) => v.toUpperCase()),
        fasecoldaCode: text,
        productionYear: z.number().int(),
        isNew: z.boolean(),
        circulationCity: text,
        accessoriesValue: z.number().min(0),
        declaredValue: z.number().positive(),
      })
      .strict(),
    applicant: z
      .object({
        documentType: z.enum(["CC", "CE"]),
        documentNumber: text,
        firstName: text,
        surname: text,
        secondSurname: z.string().trim().max(200).optional(),
        gender: z.enum(["F", "M"]),
        birthDate: text,
        city: text,
        address: text,
        phone: text,
        email: z.string().email(),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const values: QuoteFormValues = {
      vehicle: {
        ...input.vehicle,
        productionYear: String(input.vehicle.productionYear),
        accessoriesValue: String(input.vehicle.accessoriesValue),
        declaredValue: String(input.vehicle.declaredValue),
        lookupFields: [],
      },
      applicant: {
        ...input.applicant,
        secondSurname: input.applicant.secondSurname ?? "",
      },
    };
    for (const [path, message] of Object.entries(validateQuote(values)))
      ctx.addIssue({ code: "custom", path: path.split("."), message });
    const date = new Date(input.applicant.birthDate);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.applicant.birthDate ||
      date > new Date()
    )
      ctx.addIssue({
        code: "custom",
        path: ["applicant", "birthDate"],
        message: "Fecha de nacimiento inválida.",
      });
  });

export const assistantQuoteForm = {
  domain: "insurance",
  command: "quote-auto",
  groups: [
    {
      name: "Vehículo",
      fields: {
        "vehicle.plate": "Placa",
        "vehicle.fasecoldaCode": "Código Fasecolda",
        "vehicle.productionYear": "Año, número",
        "vehicle.isNew": "¿Es nuevo? booleano",
        "vehicle.circulationCity": "Código DANE de ciudad de circulación",
        "vehicle.accessoriesValue":
          "Valor de accesorios COP, número (confirmar cero si no tiene)",
        "vehicle.declaredValue": "Valor asegurado COP, número",
      },
    },
    {
      name: "Tomador",
      fields: {
        "applicant.documentType": "CC o CE",
        "applicant.documentNumber": "Número de documento",
        "applicant.firstName": "Nombres",
        "applicant.surname": "Primer apellido",
        "applicant.secondSurname": "Segundo apellido, opcional",
        "applicant.gender": "F o M",
        "applicant.birthDate": "Fecha de nacimiento YYYY-MM-DD",
      },
    },
    {
      name: "Contacto",
      fields: {
        "applicant.city": "Código DANE de ciudad de residencia",
        "applicant.address": "Dirección",
        "applicant.phone": "Teléfono",
        "applicant.email": "Correo electrónico",
      },
    },
  ],
  instructions:
    "Comienza con placa y ciudad; pide como máximo tres datos faltantes por turno. Usa savia_lookup_quote_vehicle y savia_lookup_dane_city antes de pedir códigos técnicos. No inventes datos personales, valores, códigos ni coberturas. Con todos los datos usa savia_prepare_command domain insurance, command quote-auto, input {vehicle,applicant}. La confirmación ejecuta los productos habilitados del cotizador real y guarda sus resultados. No emite ni compra una póliza.",
};
