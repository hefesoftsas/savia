import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import type { WhatsappNativeConfiguration } from "@/api/whatsapp-client";
import { render } from "../studio-engine/test/locale-test-render";
import { WhatsappNativeSettings } from "./whatsapp-native-settings";

afterEach(cleanup);

const configuration: WhatsappNativeConfiguration = {
  replyButtons: false,
  listMessages: false,
  mediaUnderstanding: false,
  readReceipts: false,
  typingIndicator: false,
  flows: [],
  catalogs: [],
  templates: [],
  media: [],
  locations: [],
};

function setup(nativeConfiguration = configuration) {
  const whatsapp = {
    getNative: vi.fn().mockResolvedValue({
      configuration: nativeConfiguration,
      configured: false,
      contributions: [
        {
          pluginId: "insurance.quotes",
          solutionId: "savia.insurance-quoter",
          bundleId: "insurance-auto-light",
          title: "Cotización de vehículo liviano",
          flowJson: { version: "7.3", screens: [] },
        },
      ],
    }),
    updateNative: vi.fn().mockResolvedValue(configuration),
    listNativeAssets: vi.fn().mockResolvedValue({ flows: [], templates: [] }),
    sendNativeMessage: vi.fn().mockResolvedValue({ messageId: "wamid.test" }),
    uploadNativeMedia: vi.fn(),
  };
  const services = { whatsapp } as unknown as AppServices;
  render(
    <MemoryRouter>
      <WhatsappNativeSettings services={services} tenantId={101} />
    </MemoryRouter>,
  );
  return whatsapp;
}

it("edits and saves tenant capability flags without sending a message", async () => {
  const whatsapp = setup();
  const user = userEvent.setup();
  const flag = await screen.findByLabelText("Respuestas con botones");
  await user.click(flag);
  await user.click(
    screen.getByRole("button", { name: "Guardar configuración nativa" }),
  );
  await waitFor(() =>
    expect(whatsapp.updateNative).toHaveBeenCalledWith({
      agencyId: 101,
      configuration: expect.objectContaining({
        replyButtons: true,
        flows: [],
        media: [],
      }),
    }),
  );
  expect(whatsapp.sendNativeMessage).not.toHaveBeenCalled();
});

it("enables read receipts with typing indicators and links model requirements", async () => {
  const whatsapp = setup();
  const user = userEvent.setup();
  const typing = await screen.findByLabelText("Indicador de escritura");
  const readReceipts = screen.getByLabelText("Confirmaciones de lectura");
  expect(readReceipts).toBeEnabled();
  await user.click(typing);
  expect(readReceipts).toBeChecked();
  expect(readReceipts).toBeDisabled();
  expect(screen.getByText(/imágenes y PDF.*visión|vision/i)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Configurar transcripción" }),
  ).toHaveAttribute("href", "/assistant-configuration");
  await user.click(
    screen.getByRole("button", { name: "Guardar configuración nativa" }),
  );
  await waitFor(() =>
    expect(whatsapp.updateNative).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          typingIndicator: true,
          readReceipts: true,
        }),
      }),
    ),
  );
});

it("requires explicit consent for native test sends and exposes contributed Flow downloads", async () => {
  const whatsapp = setup();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Descargar Flow JSON" });
  const sendButton = screen.getByRole("button", {
    name: "Enviar prueba nativa",
  });
  expect(sendButton).toBeDisabled();
  await user.type(screen.getByLabelText("Destino"), "+573001234567");
  await user.type(screen.getByLabelText("Texto"), "Hola");
  expect(sendButton).toBeDisabled();
  await user.click(
    screen.getByLabelText(
      "Confirmo consentimiento del destinatario para este mensaje de prueba",
    ),
  );
  expect(sendButton).toBeEnabled();
  expect(whatsapp.sendNativeMessage).not.toHaveBeenCalled();
});

it("invalidates recipient consent when the destination changes and after sending", async () => {
  const whatsapp = setup();
  const user = userEvent.setup();
  const destination = await screen.findByLabelText("Destino");
  const consentLabel =
    "Confirmo consentimiento del destinatario para este mensaje de prueba";
  const consent = screen.getByLabelText(consentLabel);
  const send = screen.getByRole("button", { name: "Enviar prueba nativa" });

  await user.type(destination, "+573001111111");
  await user.type(screen.getByLabelText("Texto"), "Hola");
  await user.click(consent);
  expect(send).toBeEnabled();
  await user.clear(destination);
  await user.type(destination, "+573002222222");
  expect(send).toBeDisabled();

  await user.click(screen.getByLabelText(consentLabel));
  await user.click(send);
  await waitFor(() =>
    expect(whatsapp.sendNativeMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+573002222222", consent: true }),
    ),
  );
  await waitFor(() => expect(send).toBeDisabled());
});

it("requires configured catalog products and sends only the selected IDs", async () => {
  const whatsapp = setup({
    ...configuration,
    catalogs: [
      {
        key: "auto-catalog",
        label: "Autos",
        catalogId: "123456",
        products: [
          { id: "AUTO_A", label: "Auto A" },
          { id: "AUTO_B", label: "Auto B" },
        ],
      },
    ],
  });
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Tipo"), "catalog");
  const resource = await screen.findByLabelText("Recurso configurado");
  expect(resource.querySelectorAll("option")).toHaveLength(2);
  await user.selectOptions(resource, "auto-catalog");
  await user.selectOptions(
    await screen.findByLabelText("Productos del catálogo"),
    ["AUTO_B"],
  );
  await user.type(screen.getByLabelText("Destino"), "+573001234567");
  await user.type(screen.getByLabelText("Texto"), "Mira este producto");
  await user.click(
    screen.getByLabelText(
      "Confirmo consentimiento del destinatario para este mensaje de prueba",
    ),
  );
  await user.click(
    screen.getByRole("button", { name: "Enviar prueba nativa" }),
  );
  await waitFor(() =>
    expect(whatsapp.sendNativeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        reply: {
          kind: "catalog",
          text: "Mira este producto",
          resourceKey: "auto-catalog",
          productIds: ["AUTO_B"],
        },
        consent: true,
      }),
    ),
  );
});

it("filters named resources when message kind changes and offers a media caption", async () => {
  const whatsapp = setup({
    ...configuration,
    flows: [
      { key: "quote-flow", label: "Cotizar", flowId: "12345", screen: "END" },
    ],
    media: [{ key: "photo", label: "Foto", type: "image", mediaId: "54321" }],
  });
  const user = userEvent.setup();
  const type = await screen.findByLabelText("Tipo");
  await user.selectOptions(type, "flow");
  const flowResource = await screen.findByLabelText("Recurso configurado");
  expect(
    Array.from(flowResource.querySelectorAll("option")).map(
      (item) => item.value,
    ),
  ).toEqual(["", "quote-flow"]);
  await user.selectOptions(type, "media");
  const mediaResource = await screen.findByLabelText("Recurso configurado");
  expect(
    Array.from(mediaResource.querySelectorAll("option")).map(
      (item) => item.value,
    ),
  ).toEqual(["", "photo"]);
  expect(await screen.findByLabelText("Caption (opcional)")).toBeVisible();
  expect(screen.queryByLabelText("Texto")).toBeNull();
  expect(whatsapp.sendNativeMessage).not.toHaveBeenCalled();
});
