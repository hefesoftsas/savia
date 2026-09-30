// @vitest-environment-options {"url":"https://legacy.savia-preview.hefesoft.com/"}
import { cleanup, render, screen } from "@testing-library/react";
import { I18nContextProvider } from "ra-core";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { TenantBrandingPage } from "./tenant-branding-page";

afterEach(cleanup);
it("shows the canonical server slug when opened through a legacy alias hostname", async () => {
  const get = vi.fn().mockImplementation(async (path: string) =>
    path === "/v1/tenants/current"
      ? {
          data: {
            id: 1,
            name: "One",
            kind: "commercial",
            slug: "new-canonical-name",
          },
        }
      : { data: null, canManage: false },
  );
  render(
    <I18nContextProvider
      value={{
        translate: (key: string) => key,
        changeLocale: async () => {},
        getLocale: () => "es",
      }}
    >
      <TenantBrandingPage
        services={{ apiClient: { get } } as unknown as AppServices}
      />
    </I18nContextProvider>,
  );
  expect(
    await screen.findByRole("textbox", { name: "Tu URL de Savia" }),
  ).toHaveValue("https://new-canonical-name.savia-preview.hefesoft.com");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
