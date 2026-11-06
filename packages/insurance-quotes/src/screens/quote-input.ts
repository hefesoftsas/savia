export const quoteSteps = [
  { id: "vehicle", title: "Vehículo" },
  { id: "applicant", title: "Solicitante y conductor" },
  { id: "contact", title: "Contacto y cotización" },
] as const;

export type QuoteStep = (typeof quoteSteps)[number]["id"];

type VehicleLookupField =
  | "fasecoldaCode"
  | "productionYear"
  | "declaredValue"
  | "accessoriesValue";

export type QuoteFormValues = {
  vehicle: {
    plate: string;
    fasecoldaCode: string;
    productionYear: string;
    isNew: boolean;
    circulationCity: string;
    accessoriesValue: string;
    declaredValue: string;
    lookupFields: VehicleLookupField[];
  };
  applicant: {
    documentType: string;
    documentNumber: string;
    firstName: string;
    surname: string;
    secondSurname: string;
    gender: string;
    birthDate: string;
    city: string;
    address: string;
    phone: string;
    email: string;
  };
};

export type AutoLightQuoteInput = {
  vehicle: {
    plate: string;
    fasecoldaCode: string;
    productionYear: number;
    isNew: boolean;
    circulationCity: string;
    accessoriesValue: number;
    declaredValue: number;
  };
  applicant: Omit<QuoteFormValues["applicant"], "secondSurname"> & {
    secondSurname?: string;
  };
};

export type QuoteInputField =
  | "vehicle.plate"
  | "vehicle.fasecoldaCode"
  | "vehicle.productionYear"
  | "vehicle.isNew"
  | "vehicle.circulationCity"
  | "vehicle.accessoriesValue"
  | "vehicle.declaredValue"
  | `applicant.${keyof QuoteFormValues["applicant"]}`;

export type QuoteInputErrors = Partial<Record<QuoteInputField, string>>;

export const defaultQuoteFormValues: QuoteFormValues = {
  vehicle: {
    plate: "",
    fasecoldaCode: "",
    productionYear: "",
    isNew: false,
    circulationCity: "",
    accessoriesValue: "0",
    declaredValue: "",
    lookupFields: [],
  },
  applicant: {
    documentType: "CC",
    documentNumber: "",
    firstName: "",
    surname: "",
    secondSurname: "",
    gender: "F",
    birthDate: "",
    city: "",
    address: "",
    phone: "",
    email: "",
  },
};

function normalizedPlate(value: string): string {
  return value.trim().toUpperCase();
}

function validYear(value: string): boolean {
  const year = Number(value);
  return (
    Number.isInteger(year) &&
    year >= 1900 &&
    year <= new Date().getFullYear() + 1
  );
}

function positiveNumber(value: string): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function nonNegativeNumber(value: string): boolean {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function clearLookupField(
  field: VehicleLookupField,
): Pick<QuoteFormValues["vehicle"], VehicleLookupField> {
  return { [field]: field === "accessoriesValue" ? "0" : "" } as Pick<
    QuoteFormValues["vehicle"],
    VehicleLookupField
  >;
}

export function updateQuoteValue(
  values: QuoteFormValues,
  field: QuoteInputField,
  value: string | boolean,
): QuoteFormValues {
  if (field === "vehicle.plate") {
    const plate = normalizedPlate(String(value));
    if (plate === values.vehicle.plate) {
      return { ...values, vehicle: { ...values.vehicle, plate } };
    }
    const cleared = Object.assign(
      {},
      ...values.vehicle.lookupFields.map((lookupField) =>
        clearLookupField(lookupField),
      ),
    );
    return {
      ...values,
      vehicle: {
        ...values.vehicle,
        ...cleared,
        plate,
        lookupFields: [],
      },
    };
  }
  if (field.startsWith("vehicle.")) {
    const vehicleField = field.slice("vehicle.".length) as Exclude<
      keyof QuoteFormValues["vehicle"],
      "lookupFields" | "plate"
    >;
    const lookupFields = values.vehicle.lookupFields.filter(
      (item) => item !== vehicleField,
    );
    return {
      ...values,
      vehicle: { ...values.vehicle, [vehicleField]: value, lookupFields },
    };
  }
  const applicantField = field.slice("applicant.".length) as keyof QuoteFormValues["applicant"];
  return {
    ...values,
    applicant: { ...values.applicant, [applicantField]: String(value) },
  };
}

export function applyVehicleLookup(
  values: QuoteFormValues,
  lookup: {
    plate: string;
    fasecoldaCode?: string;
    productionYear?: number;
    declaredValue?: number;
    accessoriesValue?: number;
  },
): QuoteFormValues {
  if (normalizedPlate(lookup.plate) !== values.vehicle.plate) return values;
  const vehicle = { ...values.vehicle };
  const lookupFields: VehicleLookupField[] = [];
  const candidates: Array<[VehicleLookupField, number | string | undefined]> = [
    ["fasecoldaCode", lookup.fasecoldaCode],
    ["productionYear", lookup.productionYear],
    ["declaredValue", lookup.declaredValue],
    ["accessoriesValue", lookup.accessoriesValue],
  ];
  for (const [field, value] of candidates) {
    if (value === undefined) continue;
    vehicle[field] = String(value);
    lookupFields.push(field);
  }
  return { ...values, vehicle: { ...vehicle, lookupFields } };
}

export function validateQuoteStep(
  values: QuoteFormValues,
  step: QuoteStep,
): QuoteInputErrors {
  if (step === "vehicle") {
    const errors: QuoteInputErrors = {};
    if (!values.vehicle.plate) errors["vehicle.plate"] = "Ingresa la placa.";
    if (!values.vehicle.fasecoldaCode)
      errors["vehicle.fasecoldaCode"] = "Ingresa el código Fasecolda.";
    if (!validYear(values.vehicle.productionYear))
      errors["vehicle.productionYear"] = "Ingresa un año válido.";
    if (!values.vehicle.circulationCity)
      errors["vehicle.circulationCity"] = "Ingresa la ciudad de circulación.";
    if (!nonNegativeNumber(values.vehicle.accessoriesValue))
      errors["vehicle.accessoriesValue"] = "Ingresa un valor de accesorios válido.";
    if (!positiveNumber(values.vehicle.declaredValue))
      errors["vehicle.declaredValue"] = "Ingresa un valor asegurado válido.";
    return errors;
  }
  if (step === "applicant") {
    const errors: QuoteInputErrors = {};
    if (!values.applicant.documentNumber)
      errors["applicant.documentNumber"] = "Ingresa el número de documento.";
    if (!values.applicant.firstName)
      errors["applicant.firstName"] = "Ingresa los nombres.";
    if (!values.applicant.surname)
      errors["applicant.surname"] = "Ingresa el primer apellido.";
    if (!values.applicant.gender)
      errors["applicant.gender"] = "Selecciona el sexo.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.applicant.birthDate)) {
      errors["applicant.birthDate"] = "Ingresa la fecha de nacimiento.";
    } else {
      const birth = new Date(values.applicant.birthDate);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
      if (age <= 15) {
        errors["applicant.birthDate"] = "El solicitante debe tener más de 15 años.";
      }
    }
    return errors;
  }
  const errors: QuoteInputErrors = {};
  if (!values.applicant.city)
    errors["applicant.city"] = "Ingresa la ciudad de residencia.";
  if (!values.applicant.address)
    errors["applicant.address"] = "Ingresa la dirección.";
  if (!values.applicant.phone)
    errors["applicant.phone"] = "Ingresa el teléfono.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.applicant.email))
    errors["applicant.email"] = "Ingresa un correo válido.";
  return errors;
}

export function validateQuote(values: QuoteFormValues): QuoteInputErrors {
  return Object.assign(
    {},
    ...quoteSteps.map((step) => validateQuoteStep(values, step.id)),
  );
}

export function toAutoLightQuoteInput(
  values: QuoteFormValues,
): AutoLightQuoteInput {
  return {
    vehicle: {
      plate: values.vehicle.plate,
      fasecoldaCode: values.vehicle.fasecoldaCode,
      productionYear: Number(values.vehicle.productionYear),
      isNew: values.vehicle.isNew,
      circulationCity: values.vehicle.circulationCity,
      accessoriesValue: Number(values.vehicle.accessoriesValue),
      declaredValue: Number(values.vehicle.declaredValue),
    },
    applicant: {
      documentType: values.applicant.documentType,
      documentNumber: values.applicant.documentNumber,
      firstName: values.applicant.firstName,
      surname: values.applicant.surname,
      ...(values.applicant.secondSurname
        ? { secondSurname: values.applicant.secondSurname }
        : {}),
      gender: values.applicant.gender,
      birthDate: values.applicant.birthDate,
      city: values.applicant.city,
      address: values.applicant.address,
      phone: values.applicant.phone,
      email: values.applicant.email,
    },
  };
}
