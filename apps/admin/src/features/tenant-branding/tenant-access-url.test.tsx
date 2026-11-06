// @vitest-environment-options {"url":"https://savia-preview.hefesoft.com/"}
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nContextProvider } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { TenantBrandingPage } from "./tenant-branding-page";

function setup() {
  const get = vi.fn().mockImplementation(async (path: string) =>
    path === "/v1/tenants"
      ? {
          data: [
            { id: 1, name: "One", idSlug: "one" },
            { id: 2, name: "Two", idSlug: "two" },
            { id: 3, name: "Missing slug" },
          ],
        }
      : { data: null, canManage: false },
  );
  const put = vi.fn();
  render(
    <I18nContextProvider
      value={{
        translate: (key: string) => key,
        changeLocale: async () => {},
        getLocale: () => "es",
      }}
    >
      <TenantBrandingPage
        services={{ apiClient: { get, put } } as unknown as AppServices}
      />
    </I18nContextProvider>,
  );
  return { put };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows a read-only assigned URL and copies the selected organization's preview address", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { put } = setup();
  const field = await screen.findByRole("textbox", { name: "Tu URL de Savia" });
  expect(field).toHaveAttribute("readonly");
  expect(field).toHaveValue("https://one.savia-preview.hefesoft.com");
  fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Enlace copiado.");
  expect(writeText).toHaveBeenCalledWith(
    "https://one.savia-preview.hefesoft.com",
  );
  fireEvent.change(screen.getByLabelText("Organización"), {
    target: { value: "2" },
  });
  expect(screen.getByRole("textbox", { name: "Tu URL de Savia" })).toHaveValue(
    "https://two.savia-preview.hefesoft.com",
  );
  expect(screen.queryByText("Enlace copiado.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Compartir enlace" }));
  await screen.findByText("Enlace copiado.");
  expect(writeText).toHaveBeenLastCalledWith(
    "https://two.savia-preview.hefesoft.com",
  );
  expect(put).not.toHaveBeenCalled();
});
it("shares the assigned URL using native sharing", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { share });
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Compartir enlace" }),
  );
  await screen.findByText("Enlace compartido.");
  expect(share).toHaveBeenCalledWith({
    url: "https://one.savia-preview.hefesoft.com",
  });
});
it("keeps the URL selectable and explains clipboard failure", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Copiar enlace" }));
  await screen.findByText(
    "No se pudo copiar el enlace. Selecciona la URL y cópiala manualmente.",
  );
  expect(
    screen.getByRole("textbox", { name: "Tu URL de Savia" }),
  ).not.toBeDisabled();
});
it("does not invent a URL when the organization has no assigned slug", async () => {
  setup();
  fireEvent.change(await screen.findByLabelText("Organización"), {
    target: { value: "3" },
  });
  expect(
    screen.queryByRole("textbox", { name: "Tu URL de Savia" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Copiar enlace" }),
  ).not.toBeInTheDocument();
});
it("treats cancellation of native sharing as a quiet no-op", async () => {
  vi.stubGlobal("navigator", {
    share: vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError")),
  });
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Compartir enlace" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toBeEnabled(),
  );
  expect(screen.queryByText("Enlace compartido.")).not.toBeInTheDocument();
});
