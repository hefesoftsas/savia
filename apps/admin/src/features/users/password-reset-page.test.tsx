import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CoreAdminContext } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import { PasswordResetPage } from "./password-reset-page";
import { createAppI18nProvider } from "@/lib/i18nProvider";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

it("explains missing or expired reset links and offers a new link", () => {
  window.history.replaceState(
    {},
    "",
    "/auth/reset-password?error=INVALID_TOKEN",
  );
  render(
    <CoreAdminContext i18nProvider={createAppI18nProvider("es")}>
      <PasswordResetPage apiUrl="http://localhost:8787" />
    </CoreAdminContext>,
  );
  expect(screen.getByRole("alert")).toBeVisible();
  expect(
    screen.getByRole("link", { name: /solicitar otro enlace/i }),
  ).toHaveAttribute("href", "http://localhost:8787/api/auth/forgot-password");
  expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
});

it("requires the same twelve-character password as Better Auth before sending", () => {
  window.history.replaceState({}, "", "/auth/reset-password?token=fixture");
  const fetch = vi.spyOn(globalThis, "fetch");
  render(
    <CoreAdminContext i18nProvider={createAppI18nProvider("es")}>
      <PasswordResetPage apiUrl="http://localhost:8787" />
    </CoreAdminContext>,
  );
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
    target: { value: "123456789" },
  });
  fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
    target: { value: "123456789" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Guardar contraseña" }).closest("form")!,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("12");
  expect(fetch).not.toHaveBeenCalled();
});
