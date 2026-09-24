// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WidgetCard } from "./widgets";

afterEach(cleanup);

it("renders a tenant ZIP widget through the dashboard card", async () => {
  const widget = {
    id: "plugin-widget",
    title: "Resumen",
    kind: "plugin:custom.demo:resumen",
    apiBasePath: "/v1/data-domains/platform",
    collection: "polizas",
  };
  const apiClient = {
    get: vi.fn(async () => ({
      data: [
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
      ],
    })),
  };

  render(
    <WidgetCard
      apiClient={apiClient as never}
      widget={widget as never}
      collectionLabel="Pólizas"
      onRemove={vi.fn()}
      onMove={vi.fn()}
      isFirst
      isLast
      disabled={false}
    />,
  );

  expect(await screen.findByTitle("Resumen")).toHaveAttribute(
    "src",
    expect.stringContaining("/api/plugin-store/custom.demo/widget"),
  );
});
