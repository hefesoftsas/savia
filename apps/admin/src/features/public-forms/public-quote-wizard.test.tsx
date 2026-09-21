import {
  I18nContextProvider,
  StoreContextProvider,
  memoryStore,
  useSetLocale,
} from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import type { ReactElement, ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublicQuoteForm } from "./public-quote-wizard";

const quoteDefinition = {
  id: "quote-form-id",
  title: "Cotizador por pasos",
  kind: "quote" as const,
  captchaProvider: "turnstile" as const,
  siteKey: "site-key",
  presentation: {
    renderer: "insurance-quote-wizard" as const,
    entry: "wizard" as const,
    products: Array.from({ length: 19 }, (_, i) => ({
      flowId: `flow-${i}`,
      label: `Insurer ${i} · Product ${i}`,
    })),
  },
  fields: [
    {
      name: "vehicle_plate",
      label: "Placa",
      type: "text" as const,
      required: true,
    },
    {
      name: "vehicle_fasecoldaCode",
      label: "Código Fasecolda",
      type: "text" as const,
      required: true,
    },
    {
      name: "vehicle_productionYear",
      label: "Año del vehículo",
      type: "number" as const,
      required: true,
    },
    {
      name: "vehicle_isNew",
      label: "Vehículo nuevo",
      type: "boolean" as const,
      required: false,
    },
    {
      name: "vehicle_circulationCity",
      label: "Código de ciudad de circulación",
      type: "text" as const,
      required: true,
    },
    {
      name: "vehicle_accessoriesValue",
      label: "Valor de accesorios",
      type: "number" as const,
      required: false,
    },
    {
      name: "vehicle_declaredValue",
      label: "Valor asegurado",
      type: "number" as const,
      required: true,
    },
    {
      name: "applicant_documentType",
      label: "Tipo de documento",
      type: "select" as const,
      required: true,
      options: [
        { value: "CC", label: "Cédula de ciudadanía" },
        { value: "CE", label: "Cédula de extranjería" },
      ],
    },
    {
      name: "applicant_documentNumber",
      label: "Número de documento",
      type: "text" as const,
      required: true,
    },
    {
      name: "applicant_firstName",
      label: "Nombres",
      type: "text" as const,
      required: true,
    },
    {
      name: "applicant_surname",
      label: "Primer apellido",
      type: "text" as const,
      required: true,
    },
    {
      name: "applicant_secondSurname",
      label: "Segundo apellido",
      type: "text" as const,
      required: false,
    },
    {
      name: "applicant_gender",
      label: "Sexo",
      type: "select" as const,
      required: true,
      options: [
        { value: "F", label: "Femenino" },
        { value: "M", label: "Masculino" },
      ],
    },
    {
      name: "applicant_birthDate",
      label: "Fecha de nacimiento",
      type: "date" as const,
      required: true,
    },
    {
      name: "applicant_city",
      label: "Código de ciudad de residencia",
      type: "text" as const,
      required: true,
    },
    {
      name: "applicant_address",
      label: "Dirección",
      type: "text" as const,
      required: true,
    },
    {
      name: "applicant_phone",
      label: "Teléfono",
      type: "text" as const,
      required: true,
    },
    {
      name: "applicant_email",
      label: "Correo electrónico",
      type: "email" as const,
      required: true,
    },
  ],
};

let widget: Record<string, unknown> | undefined;
const reset = vi.fn();
const remove = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  widget = undefined;
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, reference: "quote-receipt-123" }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("turnstile", {
    render: vi.fn((_element, options) => {
      widget = options;
      return "widget-id";
    }),
    reset,
    remove,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function render(ui: ReactElement) {
  return testingRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nContextProvider
        value={{
          translate: (key: string) => key,
          changeLocale: async () => {},
          getLocale: () => "es",
        }}
      >
        {children}
      </I18nContextProvider>
    ),
  });
}

async function solve() {
  await waitFor(() => expect(widget?.callback).toBeTypeOf("function"));
  act(() => (widget!.callback as (token: string) => void)("captcha-token"));
}

it("renders the plugin-shaped wizard shell with products and steps", async () => {
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  expect(
    await screen.findByText("SEGUROS · AUTOS LIVIANOS"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: /Cotizador por pasos/ }),
  ).toBeInTheDocument();
  expect(screen.getByText("19 productos")).toBeInTheDocument();
  expect(screen.getByText("Vehículo")).toBeInTheDocument();
  expect(screen.getByText("Solicitante y conductor")).toBeInTheDocument();
  expect(screen.getByText("Contacto y cotización")).toBeInTheDocument();
  // First step fields from the quote definition.
  expect(screen.getByLabelText(/Placa/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Correo electrónico/)).not.toBeInTheDocument();
  // No private admin capabilities.
  expect(screen.queryByText("Cotizaciones")).not.toBeInTheDocument();
  expect(screen.queryByText("Historial")).not.toBeInTheDocument();
  expect(screen.queryByText(/CRM/)).not.toBeInTheDocument();
});

it("advances on valid step and returns with Anterior", async () => {
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  // Try to advance without filling required fields: browser validation blocks.
  fireEvent.click(screen.getByRole("button", { name: /Siguiente paso/ }));
  expect(screen.getByLabelText(/Placa/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/Placa/), {
    target: { value: "TESTCAR" },
  });
  fireEvent.change(screen.getByLabelText(/Código Fasecolda/), {
    target: { value: "12345678" },
  });
  fireEvent.change(screen.getByLabelText(/Año del vehículo/), {
    target: { value: "2023" },
  });
  fireEvent.change(screen.getByLabelText(/Código de ciudad de circulación/), {
    target: { value: "11001" },
  });
  fireEvent.change(screen.getByLabelText(/Valor asegurado/), {
    target: { value: "50000000" },
  });

  fireEvent.click(screen.getByRole("button", { name: /Siguiente paso/ }));
  expect(
    await screen.findByLabelText(/Número de documento/),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/Placa/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Anterior/ }));
  expect(await screen.findByLabelText(/Placa/)).toBeInTheDocument();
});

it("keeps CAPTCHA and submit at the final step and posts normalized flat values", async () => {
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  // Step 1 -> fill vehicle.
  fireEvent.change(await screen.findByLabelText(/Placa/), {
    target: { value: "testcar" },
  });
  fireEvent.change(screen.getByLabelText(/Código Fasecolda/), {
    target: { value: "12345678" },
  });
  fireEvent.change(screen.getByLabelText(/Año del vehículo/), {
    target: { value: "2023" },
  });
  fireEvent.change(screen.getByLabelText(/Código de ciudad de circulación/), {
    target: { value: "11001" },
  });
  fireEvent.change(screen.getByLabelText(/Valor asegurado/), {
    target: { value: "50000000" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Siguiente paso/ }));

  // Step 2 -> fill applicant.
  fireEvent.change(await screen.findByLabelText(/Tipo de documento/), {
    target: { value: "CC" },
  });
  fireEvent.change(screen.getByLabelText(/Número de documento/), {
    target: { value: "123456789" },
  });
  fireEvent.change(screen.getByLabelText(/Nombres/), {
    target: { value: "Ada" },
  });
  fireEvent.change(screen.getByLabelText(/Primer apellido/), {
    target: { value: "Example" },
  });
  fireEvent.change(screen.getByLabelText(/Sexo/), { target: { value: "F" } });
  fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/), {
    target: { value: "1990-01-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Siguiente paso/ }));

  // Final step shows contact fields + CAPTCHA + submit.
  expect(
    await screen.findByLabelText(/Correo electrónico/),
  ).toBeInTheDocument();
  const captchaMount = await screen.findByLabelText(
    /Verificación de seguridad/,
  );
  expect(captchaMount).toBeInTheDocument();
  expect(widget).toMatchObject({
    sitekey: "site-key",
    action: "public_submit",
    cData: "quote-form-id",
  });

  fireEvent.change(screen.getByLabelText(/Código de ciudad de residencia/), {
    target: { value: "11001" },
  });
  fireEvent.change(screen.getByLabelText(/Dirección/), {
    target: { value: "Example 123" },
  });
  fireEvent.change(screen.getByLabelText(/Teléfono/), {
    target: { value: "3001234567" },
  });
  fireEvent.change(screen.getByLabelText(/Correo electrónico/), {
    target: { value: "ada@example.test" },
  });

  const submitButton = screen.getByRole("button", {
    name: /Enviar solicitud|Solicitar cotización|Cotizar/,
  });
  expect(submitButton).toBeDisabled();
  await solve();
  fireEvent.click(submitButton);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [, init] = fetchMock.mock.calls[0];
  expect(init.credentials).toBe("omit");
  const payload = JSON.parse(init.body);
  expect(payload.values.vehicle_plate).toBe("TESTCAR");
  expect(payload.values.applicant_email).toBe("ada@example.test");
  expect(payload.values).not.toHaveProperty("flowId");
  expect(payload.values).not.toHaveProperty("actionId");
  expect(JSON.stringify(payload)).not.toMatch(/provider|secret|credential/i);
});

it("looks up the plate and autofills vehicle fields like the embedded wizard", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        plate: "TESTCAR",
        fasecoldaCode: "12345678",
        productionYear: 2023,
        declaredValue: 50000000,
      }),
    ),
  );
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  fireEvent.change(await screen.findByLabelText(/Placa/), {
    target: { value: "testcar" },
  });
  // The typed plate is normalized to uppercase.
  expect(screen.getByLabelText(/Placa/)).toHaveValue("TESTCAR");
  fireEvent.click(screen.getByRole("button", { name: "Consultar placa" }));
  expect(await screen.findAllByText("✓ Autocompletado")).not.toHaveLength(0);
  expect(screen.getByLabelText(/Código Fasecolda/)).toHaveValue("12345678");
  expect(screen.getByLabelText(/Año del vehículo/)).toHaveValue(2023);
  expect(screen.getByLabelText(/Valor asegurado/)).toHaveValue("50.000.000");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/vehicle-lookup");
  expect(init.credentials).toBe("omit");
  expect(JSON.parse(init.body)).toEqual({ plate: "TESTCAR" });
  // Editing the plate clears the autofilled values.
  fireEvent.change(screen.getByLabelText(/Placa/), {
    target: { value: "DEMOCAR" },
  });
  expect(screen.getByLabelText(/Código Fasecolda/)).toHaveValue("");
  expect(screen.queryByText("✓ Autocompletado")).not.toBeInTheDocument();
});

it("auto-triggers the lookup on blur and reports an empty result", async () => {
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  fireEvent.change(await screen.findByLabelText(/Placa/), {
    target: { value: "SINCAR" },
  });
  fireEvent.blur(screen.getByLabelText(/Placa/));
  expect(
    await screen.findByText("No se encontraron datos para esa placa."),
  ).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("suggests DANE cities and stores the selected code", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      matches: [
        { code: "11001", city: "Bogotá", department: "Bogotá D.C.", junk: 1 },
        { code: "05001", city: "Medellín", department: "Antioquia" },
      ],
    }),
  );
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  fireEvent.change(
    await screen.findByLabelText(/Código de ciudad de circulación/),
    {
      target: { value: "bog" },
    },
  );
  expect(await screen.findByText("Bogotá (Bogotá D.C.)")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Bogotá (Bogotá D.C.)"));
  expect(screen.getByLabelText(/Código de ciudad de circulación/)).toHaveValue(
    "11001",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/cities?search=bog");
  expect(init.credentials).toBe("omit");
});

it("formats currency fields with thousands separators but submits raw numbers", async () => {
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  const input = await screen.findByLabelText(/Valor asegurado/);
  fireEvent.change(input, { target: { value: "50000000" } });
  expect(input).toHaveValue("50.000.000");
  fireEvent.change(input, { target: { value: "50.000.000" } });
  expect(input).toHaveValue("50.000.000");
});

it("names the failing field instead of showing the generic submit error", async () => {
  render(
    <PublicQuoteForm
      definition={quoteDefinition}
      endpoint="https://api.test/api/public/forms/quote-token"
    />,
  );
  fireEvent.change(await screen.findByLabelText(/Placa/), {
    target: { value: "TESTCAR" },
  });
  fireEvent.change(screen.getByLabelText(/Código Fasecolda/), {
    target: { value: "12345678" },
  });
  fireEvent.change(screen.getByLabelText(/Año del vehículo/), {
    target: { value: "1800" },
  });
  fireEvent.change(screen.getByLabelText(/Código de ciudad de circulación/), {
    target: { value: "11001" },
  });
  fireEvent.change(screen.getByLabelText(/Valor asegurado/), {
    target: { value: "50000000" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Siguiente paso/ }));
  const error = await screen.findByText(/Revisa el campo/);
  expect(error.textContent).toContain("Año del vehículo");
  // Still on the vehicle step, focused on the failing field.
  expect(screen.getByLabelText(/Placa/)).toBeInTheDocument();
  expect(document.activeElement).toBe(
    screen.getByLabelText(/Año del vehículo/),
  );
  expect(fetchMock).not.toHaveBeenCalled();
  // Fixing the value clears the error and advances.
  fireEvent.change(screen.getByLabelText(/Año del vehículo/), {
    target: { value: "2023" },
  });
  expect(screen.queryByText(/Revisa el campo/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Siguiente paso/ }));
  expect(
    await screen.findByLabelText(/Número de documento/),
  ).toBeInTheDocument();
});

function LocaleSwitcher() {
  const setLocale = useSetLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>ES</button>
      <button onClick={() => setLocale("en")}>EN</button>
    </>
  );
}

it("keeps field names and step controls across locales with Spanish by default", async () => {
  testingRender(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <AppLocaleProvider>
        <LocaleSwitcher />
        <PublicQuoteForm
          definition={quoteDefinition}
          endpoint="https://api.test/api/public/forms/quote-token"
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  // Spanish by default.
  expect(
    await screen.findByText("SEGUROS · AUTOS LIVIANOS"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Cotizador por pasos" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Vehículo")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Siguiente paso" }),
  ).toBeInTheDocument();
  const plate = screen.getByLabelText(/Placa/);
  fireEvent.change(plate, { target: { value: "TESTCAR" } });

  fireEvent.click(screen.getByText("EN"));
  await screen.findByText("INSURANCE · LIGHT VEHICLES");
  expect(
    screen.getByRole("heading", { name: "Step-by-step quote" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Vehicle")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next step" })).toBeInTheDocument();
  // Business content preserved, field names intact.
  expect(screen.getByLabelText(/Placa/)).toHaveValue("TESTCAR");
  expect(widget?.language).toBe("en");
});
