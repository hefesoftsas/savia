import type { FieldLabelLocale } from "./field-labels";

export const recordValidationMessages = {
  required: ["obligatorio", "required", "obrigatório"],
  number: ["debe ser un número", "must be a number", "deve ser um número"],
  integer: ["debe ser entero", "must be an integer", "deve ser um inteiro"],
  boolean: [
    "debe ser verdadero o falso",
    "must be true or false",
    "deve ser verdadeiro ou falso",
  ],
  text: ["debe ser texto", "must be text", "deve ser texto"],
  options: [
    "select valid options",
    "select valid options",
    "selecione opções válidas",
  ],
  records: [
    "selecciona registros válidos",
    "select valid records",
    "selecione registros válidos",
  ],
  option: ["opción inválida", "invalid option", "opção inválida"],
  date: ["fecha inválida", "invalid date", "data inválida"],
  dateTime: [
    "enter a valid date and time with a time zone",
    "enter a valid date and time with a time zone",
    "informe uma data e hora válidas com fuso horário",
  ],
  time: [
    "enter a valid time (HH:mm)",
    "enter a valid time (HH:mm)",
    "informe uma hora válida (HH:mm)",
  ],
  email: ["correo inválido", "invalid email", "email inválido"],
  phone: ["teléfono inválido", "invalid phone number", "telefone inválido"],
  url: ["URL inválida", "invalid URL", "URL inválida"],
  range: [
    "fuera del rango permitido",
    "outside the allowed range",
    "fora do intervalo permitido",
  ],
  length: [
    "longitud permitida %{min}–%{max}",
    "allowed length %{min}–%{max}",
    "comprimento permitido %{min}–%{max}",
  ],
  pattern: ["formato inválido", "invalid format", "formato inválido"],
  map: [
    "selecciona un punto válido en el mapa",
    "select a valid map location",
    "selecione um ponto válido no mapa",
  ],
  integerRange: [
    "enter an integer between %{min} and %{max}",
    "enter an integer between %{min} and %{max}",
    "informe um inteiro entre %{min} e %{max}",
  ],
  numberRange: [
    "enter a number between %{min} and %{max}",
    "enter a number between %{min} and %{max}",
    "informe um número entre %{min} e %{max}",
  ],
  decimals: [
    "use at most %{decimals} decimal places",
    "use at most %{decimals} decimal places",
    "use no máximo %{decimals} casas decimais",
  ],
  json: [
    "JSON inválido (%{detail})",
    "invalid JSON (%{detail})",
    "JSON inválido (%{detail})",
  ],
  unknown: [
    "Campo desconocido: %{name}",
    "Unknown field: %{name}",
    "Campo desconhecido: %{name}",
  ],
} as const;

const spanishOverrides: Partial<
  Record<keyof typeof recordValidationMessages, string>
> = {
  options: "selecciona opciones válidas",
  dateTime: "introduce fecha y hora válidas con zona horaria",
  time: "introduce una hora válida (HH:mm)",
  integerRange: "introduce un entero entre %{min} y %{max}",
  numberRange: "introduce un número entre %{min} y %{max}",
  decimals: "usa como máximo %{decimals} decimales",
};
export function recordValidationMessage(
  key: keyof typeof recordValidationMessages,
  locale?: FieldLabelLocale,
  params: Record<string, string | number> = {},
) {
  const message =
    locale === "es" && spanishOverrides[key]
      ? spanishOverrides[key]!
      : recordValidationMessages[key][
          locale === "en" ? 1 : locale === "pt" ? 2 : 0
        ];
  return message.replace(/%\{([^}]+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : token,
  );
}
