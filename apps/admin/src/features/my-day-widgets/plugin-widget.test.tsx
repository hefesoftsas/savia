import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginWidgetBody } from "./plugin-widget";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const widget = {
  id: "w_plugin1",
  apiBasePath: "/v1/data-domains/platform",
  collection: "polizas",
  kind: "plugin:insurance.portfolio-dashboard:summary",
};

function createApiClient(
  extensions: Array<{
    manifest: { id: string };
    builtIn: boolean;
    store?: boolean;
    widgets?: Array<{
      id: string;
      collection: string;
      title: { es: string };
    }>;
    installed: { enabled: boolean } | null;
  }>,
) {
  return {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/data-domains/platform/api/extensions") {
        return { data: extensions };
      }
      if (
        path ===
        "/v1/data-domains/platform/api/extensions/insurance.portfolio-dashboard/summary"
      ) {
        return {
          data: {
            total: 10,
            active: 8,
            expiring: 2,
            premiumTotal: 5000000,
            asOf: "2026-09-21T00:00:00.000Z",
          },
        };
      }
      if (path.includes("/api/records/polizas")) {
        return {
          data: [{ id: "1", name: "POL-001", estado: "Vigente" }],
          total: 10,
          page: 1,
          perPage: 5,
        };
      }
      throw new Error(`unexpected path ${path}`);
    }),
  };
}

const enabledExtension = [
  {
    manifest: { id: "insurance.portfolio-dashboard" },
    builtIn: true,
    installed: null,
  },
];

describe("PluginWidgetBody", () => {
  it("renders the owning extension widget with a scoped savia object", async () => {
    const { container } = render(
      <PluginWidgetBody
        apiClient={createApiClient(enabledExtension) as never}
        widget={widget as never}
      />,
    );

    await waitFor(() => expect(container).toHaveTextContent("Vigentes"));
    expect(container).toHaveTextContent("POL-001");
    expect(
      container.querySelector('dl[aria-label="Resumen de cartera"]'),
    ).not.toBeNull();
  });

  it("asks to enable the extension when it is not active", async () => {
    render(
      <PluginWidgetBody
        apiClient={createApiClient([]) as never}
        widget={widget as never}
      />,
    );

    expect(
      await screen.findByText(
        "Activa la extensión Resumen de cartera para ver este widget.",
      ),
    ).toBeVisible();
  });

  it("falls back gracefully for unknown plugin kinds", async () => {
    render(
      <PluginWidgetBody
        apiClient={createApiClient(enabledExtension) as never}
        widget={{ ...widget, kind: "plugin:unknown:missing" } as never}
      />,
    );

    expect(
      await screen.findByText(
        "Este tipo de widget estará disponible próximamente. Mientras tanto puedes abrir la colección completa.",
      ),
    ).toBeVisible();
  });

  it("renders store widgets in an isolated iframe", async () => {
    const { container } = render(
      <PluginWidgetBody
        apiClient={
          createApiClient([
            {
              manifest: { id: "custom.demo" },
              builtIn: false,
              store: true,
              widgets: [
                {
                  id: "resumen",
                  collection: "polizas",
                  title: { es: "Resumen" },
                },
              ],
              installed: { enabled: true },
            },
          ]) as never
        }
        widget={{ ...widget, kind: "plugin:custom.demo:resumen" } as never}
      />,
    );

    const frame = await waitFor(() => {
      const element = container.querySelector(
        "iframe[title='Resumen']",
      ) as HTMLIFrameElement | null;
      expect(element).not.toBeNull();
      return element!;
    });
    expect(frame?.getAttribute("src")).toContain(
      "/api/plugin-store/custom.demo/widget?widget=resumen",
    );
  });
});
