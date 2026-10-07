import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({
  admin: vi.fn(),
  appearance: vi.fn(),
  worker: vi.fn(),
  retire: vi.fn(),
}));
vi.mock("./app", () => {
  calls.admin();
  return { App: () => <div>Private app</div> };
});
vi.mock("./components/admin/appearance-cache", () => ({
  applyCachedAppearance: calls.appearance,
}));
vi.mock("./pwa/register-service-worker", () => ({
  registerPwaServiceWorker: calls.worker,
  retireAdministrativeWorkerForPublicRoute: calls.retire,
}));
vi.mock("./features/tenant-registration/registration-captcha", () => ({
  RegistrationCaptcha: () => null,
}));
vi.mock("./features/public-quotes/public-quote-page", () => ({
  PublicQuotePage: ({ token }: { token: string }) => (
    <div>Public quote {token}</div>
  ),
}));
vi.mock("./features/public-forms/public-form-page", () => ({
  PublicFormPage: ({ token }: { token: string }) => (
    <div>Public form {token}</div>
  ),
}));
vi.mock("./features/pages/public-page", () => ({
  PublicPage: ({ token, pageId }: { token: string; pageId?: string }) => (
    <div>
      Public page {token} {pageId}
    </div>
  ),
}));
vi.mock("./features/bookings/public-booking-page", () => ({
  PublicBookingPage: ({ token }: { token: string }) => (
    <div>Public booking {token}</div>
  ),
}));
vi.mock("./features/bookings/public-booking-manage-page", () => ({
  PublicBookingManagePage: ({ token }: { token: string }) => (
    <div>Manage booking {token}</div>
  ),
}));
import { ApplicationRoot } from "./bootstrap";
afterEach(cleanup);
it("opens a public form without importing admin services or touching private persistence", async () => {
  render(
    <ApplicationRoot pathname="/public/forms/0123456789abcdef0123456789abcdef" />,
  );
  expect(await screen.findByText(/Public form/)).toBeInTheDocument();
  expect(calls.admin).not.toHaveBeenCalled();
  expect(calls.appearance).not.toHaveBeenCalled();
  expect(calls.worker).not.toHaveBeenCalled();
});
it("opens an anonymous public page route without importing the private application", async () => {
  const previous = calls.admin.mock.calls.length;
  render(
    <ApplicationRoot pathname="/public/pages/0123456789abcdefghijkl/page-2" />,
  );
  expect(
    await screen.findByText("Public page 0123456789abcdefghijkl page-2"),
  ).toBeInTheDocument();
  expect(calls.admin.mock.calls.length).toBe(previous);
});

it("opens booking and booking management anonymously without importing private services or PWA setup", async () => {
  const previous = calls.admin.mock.calls.length;
  render(
    <ApplicationRoot pathname="/public/bookings/0123456789abcdefghijkl" />,
  );
  expect(
    await screen.findByText("Public booking 0123456789abcdefghijkl"),
  ).toBeInTheDocument();
  render(
    <ApplicationRoot pathname="/public/bookings/manage/0123456789abcdefghijkl" />,
  );
  expect(
    await screen.findByText("Manage booking 0123456789abcdefghijkl"),
  ).toBeInTheDocument();
  expect(calls.admin.mock.calls.length).toBe(previous);
  expect(calls.appearance).not.toHaveBeenCalled();
  expect(calls.worker).not.toHaveBeenCalled();
});
it("rejects malformed public paths without falling through to private login", () => {
  render(<ApplicationRoot pathname="/public/forms/invalid/nested" />);
  expect(screen.getByRole("alert")).toHaveTextContent("no es válido");
  expect(calls.admin).not.toHaveBeenCalled();
});

it("registers update recovery before importing the private application", async () => {
  render(<ApplicationRoot pathname="/" />);
  expect(await screen.findByText("Private app")).toBeInTheDocument();
  expect(calls.worker.mock.invocationCallOrder[0]).toBeLessThan(
    calls.admin.mock.invocationCallOrder[0],
  );
});

it("lets anonymous visitors switch ES/EN/PT and updates document language without private services", async () => {
  render(<ApplicationRoot pathname="/public/forms/invalid/nested" />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "El enlace público no es válido.",
  );
  fireEvent.change(screen.getByLabelText("Idioma"), {
    target: { value: "en" },
  });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The public link is invalid.",
    ),
  );
  expect(document.documentElement.lang).toBe("en");
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "pt" },
  });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "O link público é inválido.",
    ),
  );
  expect(document.documentElement.lang).toBe("pt-BR");
});

it("opens tenant registration anonymously without loading private services", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      tenantId: 4,
      tenantName: "Savia Team",
      captchaProvider: "altcha",
      loginUrl: "/api/auth/login",
    }),
  );
  const previous = calls.admin.mock.calls.length;
  render(<ApplicationRoot pathname="/register" />);
  expect(
    await screen.findByRole(
      "heading",
      {
        name: /Crea tu cuenta|Create your account|Crie sua conta/,
      },
      { timeout: 5000 },
    ),
  ).toBeInTheDocument();
  expect(calls.admin.mock.calls.length).toBe(previous);
  vi.unstubAllGlobals();
});

it("opens quote result links anonymously and keeps malformed quote paths out of private app", async () => {
  document.documentElement.lang = "es";
  localStorage.setItem("savia.locale", "es");
  const previous = calls.admin.mock.calls.length;
  const previousAppearance = calls.appearance.mock.calls.length;
  const previousWorker = calls.worker.mock.calls.length;
  const token = "a".repeat(64);
  render(<ApplicationRoot pathname={`/public/quotes/${token}`} />);
  expect(await screen.findByText(`Public quote ${token}`)).toBeInTheDocument();
  render(<ApplicationRoot pathname="/public/quotes/not-a-token" />);
  expect(screen.getByRole("alert")).toHaveTextContent("no es válido");
  expect(calls.admin.mock.calls.length).toBe(previous);
  expect(calls.appearance.mock.calls.length).toBe(previousAppearance);
  expect(calls.worker.mock.calls.length).toBe(previousWorker);
});

it("asks the public bootstrap to retire a stale administrative controller", async () => {
  const pathname = `/public/quotes/${"a".repeat(64)}`;
  const serviceWorker = { controller: { scriptURL: "/sw.js" } };
  const descriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker",
  );
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });
  try {
    render(<ApplicationRoot pathname={pathname} />);
    expect(await screen.findByText(/Public quote/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.retire).toHaveBeenCalledWith(
        pathname,
        serviceWorker,
        expect.any(Function),
      ),
    );
  } finally {
    if (descriptor)
      Object.defineProperty(navigator, "serviceWorker", descriptor);
    else
      delete (navigator as Navigator & { serviceWorker?: unknown })
        .serviceWorker;
  }
});
