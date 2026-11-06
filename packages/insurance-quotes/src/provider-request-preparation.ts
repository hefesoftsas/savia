export type RuntimeCredentialField = {
  name: string;
  kind: "secret" | "text" | "url";
  required?: boolean;
};

type PreparationContext = {
  url: URL;
  headers: Headers;
  body?: string;
  credentials: Record<string, string>;
  fetcher: typeof fetch;
};

const sbsDocumentTypeCodes: Record<string, string> = {
  CC: "1",
};

const sbsGenderCodes: Record<string, string> = {
  F: "2",
};

function sbsNumericCode(value: string, codes: Record<string, string>): string {
  const normalized = value.trim().toUpperCase();
  if (/^\d+$/.test(normalized)) return normalized;
  const code = codes[normalized];
  if (!code) throw new Error("Unsupported SBS categorical value");
  return code;
}

function replaceSbsXmlValue(
  body: string,
  element: string,
  codes: Record<string, string>,
): string {
  const expression = new RegExp(`(<${element}>)([^<]*)(</${element}>)`, "i");
  return body.replace(expression, (_match, open, value, close) => {
    return `${open}${sbsNumericCode(value, codes)}${close}`;
  });
}

function sbsXmlValue(body: string, element: string): string {
  const expression = new RegExp(`(<${element}>)([^<]*)(</${element}>)`, "i");
  const match = body.match(expression);
  if (!match) throw new Error(`SBS request is missing ${element}`);
  return match[2].trim();
}

function replaceSbsXmlText(
  body: string,
  element: string,
  value: string,
): string {
  const expression = new RegExp(`(<${element}>)([^<]*)(</${element}>)`, "i");
  return body.replace(expression, (_match, open, _previous, close) => {
    return `${open}${value}${close}`;
  });
}

function sbsBirthDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  throw new Error("Unsupported SBS birth date value");
}

function sbsNewVehicleCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return "1";
  if (normalized === "false" || normalized === "0") return "0";
  throw new Error("Unsupported SBS new vehicle value");
}

function normalizeSbsCreateSessionBody(body: string): string {
  const documentType = replaceSbsXmlValue(
    body,
    "tipoDocAseg",
    sbsDocumentTypeCodes,
  );
  const driverDocumentType = replaceSbsXmlValue(
    documentType,
    "tipoDocConduc",
    sbsDocumentTypeCodes,
  );
  const gender = replaceSbsXmlValue(
    driverDocumentType,
    "idGeneroConduc",
    sbsGenderCodes,
  );
  const birthDate = replaceSbsXmlText(
    gender,
    "fechaNacimientoConduc",
    sbsBirthDate(sbsXmlValue(gender, "fechaNacimientoConduc")),
  );
  const contactName = [
    sbsXmlValue(birthDate, "nombresAseg"),
    sbsXmlValue(birthDate, "apellido1Aseg"),
    sbsXmlValue(birthDate, "apellido2Aseg"),
  ]
    .filter(Boolean)
    .join(" ");
  const contact = replaceSbsXmlText(
    birthDate,
    "nomCompletoContacto",
    contactName,
  );
  return replaceSbsXmlText(
    contact,
    "autoEsCeroKm",
    sbsNewVehicleCode(sbsXmlValue(contact, "autoEsCeroKm")),
  );
}

export function runtimeCredentialFieldsForOperation(
  operationId: string,
): readonly RuntimeCredentialField[] {
  if (operationId === "sbs-product-8-quote") {
    return [
      { name: "sbs_product_8_coverage_1_type", kind: "text" },
      { name: "sbs_product_8_coverage_1_id", kind: "text" },
      { name: "sbs_product_8_coverage_2_type", kind: "text" },
      { name: "sbs_product_8_coverage_2_id", kind: "text" },
    ];
  }
  return [];
}

export async function prepareProviderRequest(
  operationId: string,
  context: PreparationContext,
): Promise<void> {
  if (operationId === "sbs-product-8-quote" && context.body) {
    context.body = normalizeSbsCreateSessionBody(context.body);
  }
}
