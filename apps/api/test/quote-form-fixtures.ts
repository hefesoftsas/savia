/**
 * Cotizador form fixtures used by the Savia Request runtime tests.
 *
 * The admin `auto-light-quotes` screen that used to own these helpers was
 * removed; the live Savia Request flow consumes the same `auto_light.*`
 * variables, so the fixtures live with the test that exercises them.
 */
export const quoteProducts = [
  { id: "sbs-producto-8", name: "SBS · Producto 8" },
  { id: "sbs-producto-10", name: "SBS · Gold" },
  { id: "sbs-producto-11", name: "SBS · Plata" },
];

const quoteFields = [
  "applicant.documentType",
  "applicant.documentNumber",
  "applicant.firstName",
  "applicant.surname",
  "applicant.secondSurname",
  "applicant.gender",
  "applicant.birthDate",
  "applicant.city",
  "applicant.address",
  "applicant.phone",
  "applicant.email",
  "vehicle.fasecoldaCode",
  "vehicle.productionYear",
  "vehicle.isNew",
  "vehicle.circulationCity",
  "vehicle.plate",
  "vehicle.accessoriesValue",
  "vehicle.declaredValue",
] as const;

export function quoteInput(form: Record<string, string>) {
  return Object.fromEntries(
    quoteFields.map((key) => [
      "auto_light." + key,
      key === "vehicle.plate"
        ? form[key].trim().toUpperCase()
        : form[key].trim(),
    ]),
  );
}
