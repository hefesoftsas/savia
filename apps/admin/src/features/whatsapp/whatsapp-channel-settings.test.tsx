import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WhatsappChannelSettings } from "./whatsapp-channel-settings";

const savedConfiguration = {
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
};

afterEach(cleanup);

function services(
  humanSupportContact?: string,
  configuration: Record<string, unknown> = savedConfiguration,
) {
  return {
    getChannel: vi.fn().mockResolvedValue({
      configuration: { ...configuration, humanSupportContact },
      employees: [{ id: "alice", name: "Alice" }],
      members: [{ id: "staff", name: "Adviser" }],
    }),
    updateChannel: vi.fn(async (_tenantId: number, value: any) => value),
  };
}

it("loads the configured human support contact in admin channel settings", async () => {
  const whatsapp = services("https://support.example.test/contact");
  render(<WhatsappChannelSettings whatsapp={whatsapp} tenantId={7} />);

  const input = await screen.findByLabelText(/Contacto de atención humana/);
  expect(input).toHaveValue("https://support.example.test/contact");
  expect(
    screen.getByText(/se mostrará cuando el asistente no pueda continuar/i),
  ).toBeTruthy();
  expect(
    screen.getByText(/no inicia una transferencia automática/i),
  ).toBeTruthy();
});

it("saves a changed contact through the existing channel update and clears it", async () => {
  const whatsapp = services("+57 300 123 4567");
  render(<WhatsappChannelSettings whatsapp={whatsapp} tenantId={7} />);
  const input = await screen.findByLabelText(/Contacto de atención humana/);

  fireEvent.change(input, {
    target: { value: "https://help.example.test/wa" },
  });
  fireEvent.click(
    screen.getAllByRole("button", { name: "Guardar menú y personal" })[0]!,
  );
  await waitFor(() =>
    expect(whatsapp.updateChannel).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({
        humanSupportContact: "https://help.example.test/wa",
      }),
    ),
  );

  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(
    screen.getAllByRole("button", { name: "Guardar menú y personal" })[0]!,
  );
  await waitFor(() =>
    expect(whatsapp.updateChannel).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ humanSupportContact: "" }),
    ),
  );
  expect(whatsapp.updateChannel).toHaveBeenCalledTimes(2);
});

it("treats an older channel configuration without the contact as empty", async () => {
  const whatsapp = services(undefined, {
    ...savedConfiguration,
    humanSupportContact: undefined,
  });
  render(<WhatsappChannelSettings whatsapp={whatsapp} tenantId={7} />);

  expect(
    await screen.findByLabelText(/Contacto de atención humana/),
  ).toHaveValue("");
});

it("does not expose the setting editor when the channel settings read is denied", async () => {
  const whatsapp = {
    getChannel: vi.fn().mockRejectedValue(new Error("forbidden")),
    updateChannel: vi.fn(),
  };
  render(<WhatsappChannelSettings whatsapp={whatsapp} tenantId={7} />);

  await screen.findByRole("status");
  expect(screen.queryByLabelText(/Contacto de atención humana/)).toBeNull();
  expect(whatsapp.updateChannel).not.toHaveBeenCalled();
});

it("keeps an invalid contact visible and explains the accepted format after save fails", async () => {
  const whatsapp = services("");
  whatsapp.updateChannel.mockRejectedValue(new Error("invalid contact"));
  render(<WhatsappChannelSettings whatsapp={whatsapp} tenantId={7} />);

  const input = await screen.findByLabelText(/Contacto de atención humana/);
  fireEvent.change(input, {
    target: { value: "contacto-sin-formato" },
  });
  fireEvent.click(
    screen.getAllByRole("button", { name: "Guardar menú y personal" })[0]!,
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    /teléfono o enlace HTTPS/i,
  );
  expect(input).toHaveValue("contacto-sin-formato");
});
