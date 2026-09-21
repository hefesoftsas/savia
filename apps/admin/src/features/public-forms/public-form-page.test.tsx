import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  StoreContextProvider,
  memoryStore,
  useSetLocale,
  I18nContextProvider,
} from "ra-core";
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
import { PublicFormPage } from "./public-form-page";

const definition = {
  id: "form-id",
  title: "Solicita información",
  kind: "record",
  siteKey: "site-key",
  fields: [
    {
      name: "name",
      label: "Nombre",
      type: "text",
      required: true,
      defaultValue: "PRIVATE",
    },
    { name: "age", label: "Edad", type: "number", required: false },
    { name: "consent", label: "Acepto", type: "boolean", required: true },
  ],
  record: { secret: "PRIVATE" },
  scripts: "alert('unsafe')",
};
let widget: Record<string, unknown> | undefined;
const reset = vi.fn();
const remove = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  widget = undefined;
  fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(definition)));
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
async function solve() {
  // The fields can mount before Turnstile's async loader renders this test's widget.
  // Never invoke a callback retained from the previous (unmounted) form.
  await waitFor(() => expect(widget?.callback).toBeTypeOf("function"));
  act(() => (widget!.callback as (token: string) => void)("captcha-token"));
}
async function fill() {
  fireEvent.change(await screen.findByLabelText(/Nombre/), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByLabelText(/Edad/), { target: { value: "32" } });
  fireEvent.change(screen.getByLabelText(/Acepto/), {
    target: { value: "true" },
  });
  await waitFor(() => expect(widget).toBeDefined());
}
it("uses only the anonymous definition and requires captcha before posting allowlisted values", async () => {
  render(<PublicFormPage token="public-token" />);
  expect(await screen.findByLabelText(/Nombre/)).toHaveValue("");
  await fill();
  expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Nombre/)).toHaveValue("Ana");
  expect(
    screen.getByRole("button", { name: "Enviar solicitud" }),
  ).toBeDisabled();
  expect(widget).toMatchObject({
    sitekey: "site-key",
    action: "public_submit",
    cData: "form-id",
  });
  await solve();
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, reference: "received-123" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  expect(await screen.findByText("received-123")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetchMock.mock.calls) {
    expect(String(url)).toContain("/api/public/forms/public-token");
    expect(init.credentials).toBe("omit");
  }
  const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(payload).toEqual({
    submissionId: expect.any(String),
    token: "captcha-token",
    values: { name: "Ana", age: 32, consent: true },
  });
  expect(reset).toHaveBeenCalledWith("widget-id");
  expect(remove).toHaveBeenCalledWith("widget-id");
});
it("prevents duplicate clicks and reuses submission identity after an uncertain response", async () => {
  render(<PublicFormPage token="public-token" />);
  await fill();
  await solve();
  let reject!: (error: Error) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  const button = screen.getByRole("button", { name: "Enviar solicitud" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => reject(new Error("network")));
  expect(await screen.findByRole("alert")).toHaveTextContent("confirmar");
  expect(screen.getByRole("button", { name: /Reintentar/ })).toBeDisabled();
  await solve();
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 409 }));
  fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
  expect(await screen.findByText(/ya fue recibido/)).toBeInTheDocument();
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).submissionId).toBe(
    JSON.parse(fetchMock.mock.calls[1][1].body).submissionId,
  );
});
it("removes its captcha widget on unmount and ignores expired captcha tokens", async () => {
  const view = render(<PublicFormPage token="public-token" />);
  await fill();
  await solve();
  act(() => (widget!["expired-callback"] as () => void)());
  expect(
    screen.getByRole("button", { name: "Enviar solicitud" }),
  ).toBeDisabled();
  view.unmount();
  expect(remove).toHaveBeenCalledWith("widget-id");
});
it("explains unavailable captcha configuration without starting admin requests", async () => {
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
  render(<PublicFormPage token="public-token" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("temporalmente");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not send injected fields and never renders nested result payloads", async () => {
  render(<PublicFormPage token="public-token" />);
  await fill();
  await solve();
  const injected = document.createElement("input");
  injected.name = "private_admin";
  injected.value = "secret";
  screen
    .getByLabelText(/Nombre/)
    .closest("form")!
    .append(injected);
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ok: true,
        reference: "result-ref",
        result: { status: "Recibida", raw: { secret: "PRIVATE" } },
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  await screen.findByText("result-ref");
  expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).values).not.toHaveProperty(
    "private_admin",
  );
});
it("shows a recovery message when the external captcha script fails", async () => {
  vi.stubGlobal("turnstile", undefined);
  render(<PublicFormPage token="public-token" />);
  await screen.findByLabelText(/Nombre/);
  const script = await waitFor(() => {
    const value = document.querySelector(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]',
    );
    expect(value).not.toBeNull();
    return value!;
  });
  fireEvent.error(script!);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "recarga la página",
  );
  expect(
    screen.getByRole("button", { name: "Enviar solicitud" }),
  ).toBeDisabled();
});
it("renders only the public quote projection, never provider payloads", async () => {
  render(<PublicFormPage token="public-token" />);
  await fill();
  await solve();
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ok: true,
        reference: "quote-ref",
        result: {
          quotes: [
            {
              insurer: "Savia aseguradora",
              product: "Autos",
              premiumTotal: 1234567,
              currency: "COP",
              coverages: ["Asistencia"],
              providerPayload: "PRIVATE",
            },
          ],
          unavailable: 1,
        },
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  expect(await screen.findByText("Savia aseguradora")).toBeInTheDocument();
  expect(screen.getByText("Asistencia")).toBeInTheDocument();
  expect(screen.getByText(/1\.234\.567/)).toBeInTheDocument();
  expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
});
it("accepts an explicit false answer for a required boolean", async () => {
  render(<PublicFormPage token="public-token" />);
  fireEvent.change(await screen.findByLabelText(/Nombre/), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: /Acepto/ }), {
    target: { value: "false" },
  });
  await solve();
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, reference: "false-ref" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  await screen.findByText("false-ref");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).values.consent).toBe(
    false,
  );
});

it("uses the bundled self-hosted challenge and keeps the solved proof for an uncertain retry", async () => {
  if (!customElements.get("altcha-widget")) {
    customElements.define(
      "altcha-widget",
      class extends HTMLElement {
        reset() {}
      },
    );
  }
  fetchMock.mockResolvedValueOnce(
    Response.json({
      ...definition,
      siteKey: undefined,
      captchaProvider: "altcha",
    }),
  );
  render(<PublicFormPage token="self-hosted-token" />);
  fireEvent.change(await screen.findByLabelText(/Nombre/), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByLabelText(/Acepto/), {
    target: { value: "true" },
  });
  const element = await waitFor(() => {
    const value = document.querySelector("altcha-widget");
    expect(value).not.toBeNull();
    return value!;
  });
  expect(element.getAttribute("challenge")).toContain(
    "/api/public/forms/self-hosted-token/challenge",
  );
  expect(window.turnstile?.render).not.toHaveBeenCalled();
  act(() =>
    element.dispatchEvent(
      new CustomEvent("verified", { detail: { payload: "self-hosted-proof" } }),
    ),
  );
  fetchMock.mockRejectedValueOnce(new Error("Connection closed after commit"));
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("confirmar");
  act(() =>
    element.dispatchEvent(
      new CustomEvent("statechange", { detail: { state: "expired" } }),
    ),
  );
  const retry = screen.getByRole("button", {
    name: /Reintentar el mismo envío/,
  });
  expect(retry).toBeEnabled();
  fetchMock.mockResolvedValueOnce(
    Response.json({ ok: true, reference: "self-hosted-receipt" }),
  );
  fireEvent.click(retry);
  expect(await screen.findByText("self-hosted-receipt")).toBeInTheDocument();
  expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
  expect(
    fetchMock.mock.calls.every(
      ([url]) => !String(url).includes("cloudflare.com"),
    ),
  ).toBe(true);
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

function LocaleSwitcher() {
  const setLocale = useSetLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>ES</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}
it("selects the public quote wizard for quote definitions with a presentation descriptor", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ...definition,
        kind: "quote",
        title: "Cotizador por pasos",
        presentation: {
          renderer: "insurance-quote-wizard",
          entry: "wizard",
          products: [
            { flowId: "sbs-producto-8", label: "SBS · Autos Producto 8" },
          ],
        },
      }),
    ),
  );
  render(<PublicFormPage token="quote-token" />);
  expect(await screen.findByText(/Cotizador por pasos/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Nombre/)).not.toBeInTheDocument();
});
it("submits without a captcha widget when verification is disabled locally", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ...definition,
        siteKey: undefined,
        captchaProvider: "disabled",
      }),
    ),
  );
  render(<PublicFormPage token="local-token" />);
  fireEvent.change(await screen.findByLabelText(/Nombre/), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByLabelText(/Acepto/), {
    target: { value: "true" },
  });
  const button = screen.getByRole("button", { name: "Enviar solicitud" });
  await waitFor(() => expect(button).toBeEnabled());
  expect(window.turnstile?.render).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, reference: "local-123" })),
  );
  fireEvent.click(button);
  expect(await screen.findByText("local-123")).toBeInTheDocument();
  const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(payload.token).toBe("local-bypass");
  expect(
    fetchMock.mock.calls.every(
      ([url]) => !String(url).includes("cloudflare.com"),
    ),
  ).toBe(true);
});
it("keeps the generic form for record definitions without a presentation descriptor", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(definition)));
  render(<PublicFormPage token="record-token" />);
  expect(await screen.findByLabelText(/Nombre/)).toBeInTheDocument();
  expect(screen.queryByText(/Cotizador por pasos/)).not.toBeInTheDocument();
});
it("fails closed for an unknown presentation descriptor", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ...definition,
        kind: "quote",
        presentation: {
          renderer: "evil-widget",
          entry: "wizard",
          products: [{ flowId: "x", label: "X" }],
        },
      }),
    ),
  );
  render(<PublicFormPage token="evil-token" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no está disponible",
  );
});
it("switches public form chrome and captcha language while preserving entered business content", async () => {
  testingRender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <LocaleSwitcher />
        <PublicFormPage token="public-token" />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  const input = await screen.findByLabelText(/Nombre/);
  fireEvent.change(input, { target: { value: "Ana business content" } });
  expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  await waitFor(() => expect(widget?.language).toBe("en"));
  fireEvent.click(screen.getByText("ES"));
  await screen.findByRole("button", { name: "Enviar solicitud" });
  expect(screen.getByLabelText(/Nombre/)).toHaveValue("Ana business content");
  await waitFor(() => expect(widget?.language).toBe("es"));
  fireEvent.click(screen.getByText("PT"));
  await screen.findByRole("button", { name: "Enviar solicitação" });
  expect(screen.getByLabelText(/Nombre/)).toHaveValue("Ana business content");
  await waitFor(() => expect(widget?.language).toBe("pt"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
