import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { WhatsappAssistantSettings } from "./whatsapp-assistant-settings";

afterEach(cleanup);
function setup(ready = true) {
  const services = {
    whatsapp: {
      getAssistant: vi.fn().mockResolvedValue({
        settings: null,
        employees: [{ id: "employee", name: "Atención" }],
        webhookReady: ready,
      }),
      updateAssistant: vi.fn().mockResolvedValue({}),
    },
  } as unknown as AppServices;
  render(
    <WhatsappAssistantSettings services={services} tenantId={101} connected />,
  );
  return services;
}

it("saves an explicit tenant employee and readable contact allowlist", async () => {
  const services = setup();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Asistente"),
    "employee",
  );
  await user.type(
    screen.getByLabelText("Contactos de prueba"),
    "+57 300 1234567",
  );
  await user.click(screen.getByLabelText("Responder con IA"));
  await user.click(screen.getByRole("button", { name: "Guardar asistente" }));
  await waitFor(() =>
    expect(services.whatsapp.updateAssistant).toHaveBeenCalledWith({
      agencyId: 101,
      employeeId: "employee",
      enabled: true,
      allowedContacts: ["+57 300 1234567"],
    }),
  );
});

it("keeps automatic replies disabled until inbound setup is ready", async () => {
  setup(false);
  expect(
    await screen.findByText("Recepción de WhatsApp pendiente de configurar."),
  ).toBeVisible();
  expect(screen.getByLabelText("Responder con IA")).toBeDisabled();
});

it("can turn off a saved assistant after the sender disconnects", async () => {
  const updateAssistant = vi.fn().mockResolvedValue({});
  const services = {
    whatsapp: {
      getAssistant: vi.fn().mockResolvedValue({
        settings: {
          employeeId: "employee",
          enabled: true,
          allowedContacts: ["573001234567"],
        },
        employees: [{ id: "employee", name: "Atención" }],
        webhookReady: false,
      }),
      updateAssistant,
    },
  } as unknown as AppServices;
  render(
    <WhatsappAssistantSettings
      services={services}
      tenantId={101}
      connected={false}
    />,
  );
  const checkbox = await screen.findByLabelText("Responder con IA");
  await waitFor(() => expect(checkbox).toBeChecked());
  expect(checkbox).toBeEnabled();
  const user = userEvent.setup();
  await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: "Guardar asistente" }));
  await waitFor(() =>
    expect(updateAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    ),
  );
});
