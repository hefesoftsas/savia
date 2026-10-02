import { I18nContextProvider } from "ra-core";
import type { ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/api-client";
import { AnimationCatalog } from "./animation-catalog";
const free = {
  id: "favorite",
  name: "Favorite star",
  author: "Hyouk Seo",
  license: "MIT",
  licenseUrl:
    "https://github.com/spemer/lottie-animations-json/blob/main/LICENSE",
  sourceUrl:
    "https://github.com/spemer/lottie-animations-json/blob/main/ic_fav/ic_fav.json",
  keywords: ["star"],
};
afterEach(cleanup);
it("shows only verified MIT results, searches and selects without submitting the branding form", async () => {
  const get = vi.fn().mockImplementation(async (path: string) =>
    path.includes("/favorite")
      ? { v: "5.7.0", fr: 30, ip: 0, op: 60, layers: [] }
      : {
          data: [
            free,
            { ...free, id: "premium", name: "Paid star", license: "Premium" },
            { ...free, id: "unknown", name: "Unknown star", license: null },
          ],
        },
  );
  const select = vi.fn();
  const submit = vi.fn((e) => e.preventDefault());
  render(
    <form onSubmit={submit}>
      <AnimationCatalog
        apiClient={{ get } as unknown as ApiClient}
        path="/v1/tenants/1/branding"
        disabled={false}
        onSelect={select}
      />
    </form>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Explorar animaciones gratuitas" }),
  );
  await screen.findByText("Favorite star");
  expect(screen.queryByText("Paid star")).toBeNull();
  expect(screen.queryByText("Unknown star")).toBeNull();
  fireEvent.change(screen.getByLabelText("Buscar animaciones gratuitas"), {
    target: { value: "estrella" },
  });
  fireEvent.keyDown(screen.getByLabelText("Buscar animaciones gratuitas"), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      "/v1/tenants/1/branding/animations?q=estrella",
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Usar Favorite star" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Usar Favorite star" }));
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ id: "favorite", license: "MIT" }),
    expect.objectContaining({ layers: [] }),
  );
  expect(submit).not.toHaveBeenCalled();
});
it("offers retry after catalog failure and an empty search state", async () => {
  const get = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ data: [] });
  render(
    <AnimationCatalog
      apiClient={{ get } as unknown as ApiClient}
      path="/v1/tenants/1/branding"
      disabled={false}
      onSelect={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Explorar animaciones gratuitas" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Reintentar búsqueda" }));
  await screen.findByText("No encontramos animaciones. Prueba otra palabra.");
});

function render(ui: ReactElement) {
  return testingRender(
    <I18nContextProvider
      value={{
        translate: (key: string) => key,
        changeLocale: async () => {},
        getLocale: () => "es",
      }}
    >
      {ui}
    </I18nContextProvider>,
  );
}
