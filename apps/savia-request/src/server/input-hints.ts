const hints: Record<string, Record<string, unknown>> = {
  "applicant.documentType": {
    title: "Tipo de documento",
    enum: ["CC"],
    default: "CC",
    options: { CC: "Cédula de ciudadanía" },
  },
  "applicant.documentNumber": { title: "Número de documento" },
  "applicant.firstName": { title: "Nombres" },
  "applicant.surname": { title: "Primer apellido" },
  "applicant.secondSurname": { title: "Segundo apellido", required: false },
  "applicant.gender": {
    title: "Sexo",
    enum: ["F"],
    options: { F: "Femenino" },
  },
  "applicant.birthDate": { title: "Fecha de nacimiento", format: "date" },
  "applicant.city": { title: "Código de ciudad de residencia" },
  "applicant.address": { title: "Dirección" },
  "applicant.phone": { title: "Teléfono" },
  "applicant.email": { title: "Correo electrónico", format: "email" },
  "vehicle.plate": { title: "Placa", transform: "uppercase" },
  "vehicle.fasecoldaCode": { title: "Código Fasecolda" },
  "vehicle.productionYear": {
    title: "Año del vehículo",
    type: "Number",
    integer: true,
    minimum: 1900,
  },
  "vehicle.isNew": {
    title: "Vehículo nuevo",
    enum: ["false", "true"],
    default: "false",
    options: { false: "No", true: "Sí" },
  },
  "vehicle.circulationCity": { title: "Código de ciudad de circulación" },
  "vehicle.accessoriesValue": {
    title: "Valor de accesorios",
    type: "Number",
    default: 0,
    minimum: 0,
  },
  "vehicle.declaredValue": {
    title: "Valor asegurado",
    type: "Number",
    minimum: 1,
  },
};
export function inputHint(key: string) {
  if (key === "sura_test_plate")
    return {
      title: "Placa",
      "x-savia-field": {
        bind: "auto_light.vehicle.plate",
        output: {
          "auto_light.vehicle.fasecoldaCode": "/data/vehicle/fasecoldaCode",
          "auto_light.vehicle.productionYear": "/data/vehicle/year",
          "auto_light.vehicle.declaredValue": "/data/vehicle/insuredValue",
          "auto_light.vehicle.accessoriesValue":
            "/data/vehicle/accessoriesValue",
        },
      },
    };
  const name = key.replace(/^auto_light\./, "");
  const hint = hints[name];
  if (!hint) return {};
  const { title, format, enum: choices, default: defaultValue, ...ui } = hint;
  const section = name.startsWith("vehicle.") ? "vehicle" : "applicant";
  return {
    title,
    ...(format ? { format } : {}),
    ...(choices ? { enum: choices } : {}),
    ...(defaultValue !== undefined ? { default: String(defaultValue) } : {}),
    "x-savia-field": {
      ...ui,
      order: Object.keys(hints).indexOf(name),
      section,
      sectionOrder: section === "vehicle" ? 0 : 1,
      sectionLabel:
        section === "vehicle" ? "Vehículo" : "Solicitante y conductor",
    },
  };
}
