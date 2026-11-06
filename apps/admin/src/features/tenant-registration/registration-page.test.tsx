import { StoreContextProvider, memoryStore } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationPage } from "./registration-page";
const widget = vi.hoisted(() => ({
  onToken: null as null | ((s: string) => void),
}));
vi.mock("./registration-captcha", () => ({
  RegistrationCaptcha: ({ onToken }: { onToken: (s: string) => void }) => {
    widget.onToken = onToken;
    return (
      <button type="button" onClick={() => onToken("verified-proof")}>
        Complete verification
      </button>
    );
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const config = {
  tenantId: 4,
  tenantName: "Savia Team",
  captchaProvider: "altcha",
  loginUrl: "/api/auth/login",
};
function setup(response = 200) {
  vi.stubGlobal(
    "fetch",
    async (_url: RequestInfo | URL, options?: RequestInit) =>
      options?.method === "POST"
        ? new Response(JSON.stringify({ status: true }), {
            status: response,
            headers: { "content-type": "application/json" },
          })
        : Response.json(config),
  );
  render(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <AppLocaleProvider>
        <RegistrationPage />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}
async function fill(password = "a-secure-password", confirmation = password) {
  await screen.findByRole("heading", { name: "Crea tu cuenta" });
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "New Member" },
  });
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "member@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
    target: { value: confirmation },
  });
  fireEvent.click(screen.getByText("Complete verification"));
}
it("shows tenant branding and generic email confirmation after CAPTCHA", async () => {
  setup();
  await fill();
  expect(screen.getByText("Savia Team")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  expect(
    await screen.findByRole("heading", { name: "Revisa tu correo" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Volver al inicio de sesión" }),
  ).toHaveAttribute("href", "/api/auth/login");
});
it("checks password confirmation without sending the signup", async () => {
  setup();
  await fill("a-secure-password", "different-password");
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Las contraseñas no coinciden",
  );
});
it("fails closed when registration is disabled", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
  render(
    <StoreContextProvider value={memoryStore({ locale: "es" })}>
      <AppLocaleProvider>
        <RegistrationPage />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "registro no está disponible",
  );
  expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
});
it("explains rate limits and keeps keyboard labels", async () => {
  setup(429);
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Espera antes de intentarlo otra vez",
  );
  expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
    "autoComplete",
    "new-password",
  );
});
