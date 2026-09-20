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
}));
vi.mock("./features/public-forms/public-form-page", () => ({
  PublicFormPage: ({ token }: { token: string }) => (
    <div>Public form {token}</div>
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
