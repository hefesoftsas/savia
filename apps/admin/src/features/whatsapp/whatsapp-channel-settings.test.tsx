import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WhatsappChannelSettings } from "./whatsapp-channel-settings";

it("loads published task labels and keeps staff registry separate from admission", async () => {
  const whatsapp = {
    getChannel: vi.fn().mockResolvedValue({
      configuration: {
        routingEnabled: true,
        tasks: [
          {
            id: "quotes",
            employeeId: "alice",
            title: "Consultar seguros",
            description: "Seguros",
            order: 0,
            audiences: ["external"],
          },
        ],
        staff: [
          {
            phone: "573001234567",
            label: "Adviser",
            active: true,
            principalId: "staff",
          },
        ],
        internalCapabilities: ["*"],
        externalCapabilities: ["insurance"],
      },
      employees: [{ id: "alice", name: "Alice" }],
      members: [{ id: "staff", name: "Adviser" }],
    }),
    updateChannel: vi.fn(),
  };
  render(<WhatsappChannelSettings whatsapp={whatsapp} tenantId={7} />);
  await waitFor(() =>
    expect(screen.getByDisplayValue("Consultar seguros")).toBeTruthy(),
  );
  expect(screen.getByText("Números del personal interno")).toBeTruthy();
  expect(screen.getByText(/menú o inicio/)).toBeTruthy();
  expect(screen.getByDisplayValue("573001234567")).toBeTruthy();
});
