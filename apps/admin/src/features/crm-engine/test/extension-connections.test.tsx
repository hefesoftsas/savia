// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExtensionConnections } from "../extension-connections";

afterEach(cleanup);

it("saves a generic extension connection without rendering its secret later", async () => {
  const user = userEvent.setup();
  const client = {
    listConnections: vi.fn().mockResolvedValue([]),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    removeConnection: vi.fn().mockResolvedValue(undefined),
  };

  render(
    <ExtensionConnections
      extensionId="inventory.sync"
      client={client}
      connectors={[
        {
          connectorId: "warehouse",
          label: "Bodega principal",
          fields: [
            { name: "endpoint", label: "Endpoint" },
            { name: "apiKey", label: "API key", secret: true },
          ],
        },
      ]}
    />,
  );

  await user.type(await screen.findByLabelText("Identificador"), "warehouse");
  await user.type(screen.getByLabelText("Endpoint"), "https://warehouse.test");
  await user.type(screen.getByLabelText("API key"), "secret-value");
  await user.click(screen.getByRole("button", { name: "Guardar conexión" }));

  expect(client.replaceConnection).toHaveBeenCalledWith(
    "inventory.sync",
    "warehouse",
    {
      connectorId: "warehouse",
      values: { endpoint: "https://warehouse.test", apiKey: "secret-value" },
    },
  );
});
