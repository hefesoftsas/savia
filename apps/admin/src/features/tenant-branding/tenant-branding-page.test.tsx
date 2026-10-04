import { I18nContextProvider } from "ra-core";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import {
  act,
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import { TenantBrandingPage } from "./tenant-branding-page";
const branding = {
  displayName: "Agencia Uno",
  loginTitle: "Bienvenido",
  loginDescription: "Tu espacio de trabajo",
  primaryColor: "#125633",
  accentColor: "#d1e8d9",
  logoUrl: null,
  coverUrl: null,
  loginAnimationUrl: null,
  loginAnimationRepeat: true,
  version: 1,
};
const lottie = JSON.stringify({
  v: "5.7.0",
  fr: 60,
  ip: 0,
  op: 120,
  layers: [],
});
function service(
  get: (path: string, ...args: unknown[]) => unknown,
  put = vi.fn(),
  requestResponse = vi.fn(),
  authSession = { login: vi.fn() },
) {
  const apiGet = vi.fn((path: string, ...args: unknown[]) => {
    if (path.endsWith("/api-keys")) return Promise.resolve({ keys: [] });
    if (path.endsWith("/api-keys/members"))
      return Promise.resolve({ members: [] });
    return get(path, ...args);
  });
  return {
    apiClient: {
      get: apiGet,
      put,
      post: vi.fn(),
      delete: vi.fn(),
      requestResponse,
    },
    authSession,
  } as unknown as AppServices;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("previews edits locally, saves explicitly with the loaded version and resets unsaved changes", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const put = vi.fn().mockResolvedValue({
    data: { ...branding, displayName: "Nueva marca", version: 2 },
  });
  render(<TenantBrandingPage services={service(get, put)} />);
  await screen.findByLabelText("Nombre visible");
  fireEvent.change(await screen.findByLabelText("Nombre visible"), {
    target: { value: "Nueva marca" },
  });
  expect(screen.getByLabelText("Vista previa de marca")).toHaveTextContent(
    "Nueva marca",
  );
  expect(put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByText("Marca guardada.");
  expect(put).toHaveBeenCalledWith("/v1/tenants/1/branding", {
    ...branding,
    displayName: "Nueva marca",
  });
  fireEvent.change(screen.getByLabelText("Nombre visible"), {
    target: { value: "Sin guardar" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
  expect(screen.getByLabelText("Nombre visible")).toHaveValue("Nueva marca");
});
it("saves the login animation repeat preference with tenant branding", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const put = vi.fn().mockResolvedValue({
    data: { ...branding, loginAnimationRepeat: false, version: 2 },
  });
  render(<TenantBrandingPage services={service(get, put)} />);
  await selectTab("Pantalla de acceso");
  const repeat = await screen.findByLabelText("Repetir animación");
  expect(repeat).toBeChecked();
  fireEvent.click(repeat);
  expect(repeat).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByText("Marca guardada.");
  expect(put).toHaveBeenCalledWith(
    "/v1/tenants/1/branding",
    expect.objectContaining({ loginAnimationRepeat: false }),
  );
});
it("retains local edits after a version conflict and offers explicit reload", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const put = vi
    .fn()
    .mockRejectedValue(new ApiClientError(409, "conflict", "conflict"));
  render(<TenantBrandingPage services={service(get, put)} />);
  fireEvent.change(await screen.findByLabelText("Nombre visible"), {
    target: { value: "Mi edición" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("otra persona");
  expect(screen.getByLabelText("Nombre visible")).toHaveValue("Mi edición");
  expect(
    screen.getByRole("button", { name: "Cargar versión guardada" }),
  ).toBeInTheDocument();
});
it("ignores an older tenant response after selection changes", async () => {
  let resolveOld!: (value: unknown) => void;
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        { id: 1, name: "Agencia Uno" },
        { id: 2, name: "Agencia Dos" },
      ],
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({
      data: { ...branding, displayName: "Agencia Dos" },
      canManage: false,
    });
  render(<TenantBrandingPage services={service(get)} />);
  const picker = await screen.findByLabelText("Organización");
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      "/v1/tenants/1/branding",
      expect.anything(),
    ),
  );
  fireEvent.change(picker, { target: { value: "2" } });
  expect(await screen.findByLabelText("Nombre visible")).toHaveValue(
    "Agencia Dos",
  );
  await act(async () => resolveOld({ data: branding, canManage: true }));
  expect(screen.getByLabelText("Nombre visible")).toHaveValue("Agencia Dos");
  expect(
    screen.getByRole("button", { name: "Guardar cambios" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("region", { name: "Claves API del tenant" }),
  ).not.toBeInTheDocument();
});
it("rejects unsafe image types without uploading or saving", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const upload = vi.fn();
  const put = vi.fn();
  render(<TenantBrandingPage services={service(get, put, upload)} />);
  fireEvent.change(await screen.findByLabelText("Subir logo"), {
    target: {
      files: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })],
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "PNG, JPEG o WEBP",
  );
  expect(upload).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
it("keeps uploaded image previews local until save and releases them on discard", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const asset =
    "/api/public/tenant-branding/assets/1/12345678-1234-4234-8234-123456789012";
  const upload = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: { url: asset } })));
  const put = vi.fn();
  const release = vi.fn();
  const NativeURL = URL;
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:pending-logo");
      static revokeObjectURL = release;
    },
  );
  try {
    render(<TenantBrandingPage services={service(get, put, upload)} />);
    fireEvent.change(await screen.findByLabelText("Subir logo"), {
      target: { files: [new File(["png"], "logo.png", { type: "image/png" })] },
    });
    expect(await screen.findByAltText("Logo de Agencia Uno")).toHaveAttribute(
      "src",
      "blob:pending-logo",
    );
    expect(upload.mock.calls[0][0]).toBe("/v1/tenants/1/branding/assets/logo");
    expect(upload.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(
      screen.queryByAltText("Logo de Agencia Uno"),
    ).not.toBeInTheDocument();
    expect(release).toHaveBeenCalledWith("blob:pending-logo");
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});
it("rejects invalid Lottie files without uploading", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const upload = vi.fn();
  render(<TenantBrandingPage services={service(get, vi.fn(), upload)} />);
  await selectTab("Pantalla de acceso");
  fireEvent.change(await screen.findByLabelText("Subir animación Lottie"), {
    target: { files: [new File(["<svg/>"], "anim.json", { type: "" })] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Lottie JSON");
  expect(upload).not.toHaveBeenCalled();
});
it("uploads a Lottie animation and restores the default without images", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const asset =
    "/api/public/tenant-branding/assets/1/12345678-1234-4234-8234-123456789012";
  const upload = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: { url: asset } })));
  render(<TenantBrandingPage services={service(get, vi.fn(), upload)} />);
  await selectTab("Pantalla de acceso");
  fireEvent.change(await screen.findByLabelText("Subir animación Lottie"), {
    target: { files: [new File([lottie], "login.json", { type: "" })] },
  });
  expect(
    await screen.findByText("Animación seleccionada: login.json."),
  ).toBeInTheDocument();
  expect(upload.mock.calls[0][0]).toBe(
    "/v1/tenants/1/branding/assets/login-animation",
  );
  expect(
    screen.getByRole("button", { name: "Restaurar animación por defecto" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Restaurar animación por defecto" }),
  );
  expect(
    screen.queryByRole("button", { name: "Restaurar animación por defecto" }),
  ).not.toBeInTheDocument();
});
it("does not accept an external image URL returned by an upload", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const upload = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ data: { url: "https://external.example/logo.svg" } }),
      ),
    );
  render(<TenantBrandingPage services={service(get, vi.fn(), upload)} />);
  fireEvent.change(await screen.findByLabelText("Subir logo"), {
    target: { files: [new File(["png"], "logo.png", { type: "image/png" })] },
  });
  await screen.findByRole("alert");
  expect(screen.queryByAltText("Logo de Agencia Uno")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Guardar cambios" }),
  ).toBeDisabled();
});

it("offers only active commercial tenants", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        { id: 9, name: "Platform", kind: "platform", isActive: true },
        { id: 2, name: "Inactive", kind: "commercial", isActive: false },
        { id: 3, name: "Inactive numeric", kind: "commercial", isActive: 0 },
        { id: 1, name: "Agencia Uno", kind: "commercial", isActive: true },
      ],
    })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  render(<TenantBrandingPage services={service(get)} />);
  await screen.findByLabelText("Nombre visible");
  expect(screen.queryByLabelText("Organización")).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      "Cambiar de organización descarta los cambios que no hayas guardado.",
    ),
  ).not.toBeInTheDocument();
  expect(get).toHaveBeenLastCalledWith(
    "/v1/tenants/1/branding",
    expect.anything(),
  );
});

it("keeps branding drafts when switching between identity and login tabs", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  render(<TenantBrandingPage services={service(get)} />);
  fireEvent.change(await screen.findByLabelText("Nombre visible"), {
    target: { value: "Marca en borrador" },
  });
  await selectTab("Pantalla de acceso");
  fireEvent.change(screen.getByLabelText("Título de acceso"), {
    target: { value: "Acceso en borrador" },
  });
  expect(screen.getByText(/Cambios sin guardar/)).toBeInTheDocument();
  await selectTab("Identidad");
  expect(screen.getByLabelText("Nombre visible")).toHaveValue(
    "Marca en borrador",
  );
  await selectTab("Pantalla de acceso");
  expect(screen.getByLabelText("Título de acceso")).toHaveValue(
    "Acceso en borrador",
  );
});

it("saves from the login tab when the required identity name is valid", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const put = vi.fn().mockResolvedValue({ data: { ...branding, version: 2 } });
  render(<TenantBrandingPage services={service(get, put)} />);
  await selectTab("Pantalla de acceso");
  fireEvent.change(await screen.findByLabelText("Título de acceso"), {
    target: { value: "Acceso nuevo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByText("Marca guardada.");
  expect(put).toHaveBeenCalledWith(
    "/v1/tenants/1/branding",
    expect.objectContaining({
      displayName: "Agencia Uno",
      loginTitle: "Acceso nuevo",
    }),
  );
});

it("rejects saving from the login tab when the hidden identity name is invalid", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  const put = vi.fn();
  render(<TenantBrandingPage services={service(get, put)} />);
  fireEvent.change(await screen.findByLabelText("Nombre visible"), {
    target: { value: "" },
  });
  await selectTab("Pantalla de acceso");
  expect(screen.getByLabelText("Nombre visible")).not.toBeRequired();
  fireEvent.change(screen.getByLabelText("Título de acceso"), {
    target: { value: "Acceso nuevo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Revisa los textos, los colores, las imágenes y la animación antes de guardar.",
  );
  expect(put).not.toHaveBeenCalled();
});

it("hides the API keys tab from read-only tenant members", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: false });
  render(<TenantBrandingPage services={service(get)} />);
  await screen.findByLabelText("Nombre visible");
  expect(
    screen.queryByRole("tab", { name: "Claves API" }),
  ).not.toBeInTheDocument();
});

it("loads API keys only after opening the tab and hides branding controls there", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: 1, name: "Agencia Uno" }] })
    .mockResolvedValueOnce({ data: branding, canManage: true });
  render(<TenantBrandingPage services={service(get)} />);
  await screen.findByLabelText("Nombre visible");
  expect(
    get.mock.calls.every(([path]) => !String(path).includes("api-keys")),
  ).toBe(true);
  await selectTab("Claves API");
  expect(
    screen.queryByRole("button", { name: "Guardar cambios" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Vista previa de marca" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("region", { name: "Claves API del tenant" }),
  ).toBeInTheDocument();
});

function render(ui: ReactElement) {
  return testingRender(
    <MemoryRouter>
      <I18nContextProvider
        value={{
          translate: (key: string) => key,
          changeLocale: async () => {},
          getLocale: () => "es",
        }}
      >
        {ui}
      </I18nContextProvider>
    </MemoryRouter>,
  );
}

async function selectTab(name: string) {
  await userEvent.setup().click(await screen.findByRole("tab", { name }));
}

it("offers tenant creation to platform administrators without commercial organizations", async () => {
  const get = vi.fn().mockResolvedValueOnce({
    data: [
      { id: 0, name: "Plataforma Savia", kind: "platform", isActive: true },
    ],
  });
  render(<TenantBrandingPage services={service(get)} />);
  expect(
    await screen.findByText("Aún no hay organizaciones comerciales"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Crear organización" }),
  ).toHaveAttribute("href", "/tenants/create");
  expect(get).toHaveBeenCalledTimes(1);
});

it("directs users without organizations to request access", async () => {
  const get = vi.fn().mockResolvedValueOnce({ data: [] });
  render(<TenantBrandingPage services={service(get)} />);
  expect(
    await screen.findByText("No tienes organizaciones asignadas"),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Crear organización" }),
  ).not.toBeInTheDocument();
});

it("offers sign-in again when the session expires instead of a dead reload", async () => {
  const get = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiClientError(401, "AUTHENTICATION_REQUIRED", "Sign in"),
    );
  const login = vi.fn();
  const services = {
    apiClient: { get, put: vi.fn(), requestResponse: vi.fn() },
    authSession: { login },
  } as unknown as AppServices;
  render(<TenantBrandingPage services={services} />);
  expect(
    await screen.findByText(
      "Tu sesión expiró. Inicia sesión de nuevo para continuar.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Iniciar sesión de nuevo" }),
  );
  expect(login).toHaveBeenCalledTimes(1);
  // Reload is still available for transient failures.
  expect(
    screen.getByRole("button", { name: "Volver a cargar" }),
  ).toBeInTheDocument();
});
