import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import { afterEach, expect, it, vi } from "vitest";
import { MyDayWidgetsSection } from "./section";
afterEach(cleanup);
function service(connected = true) {
  return {
    listConnections: vi.fn(async () =>
      connected
        ? [
            {
              provider: "gmail",
              status: "connected",
              externalAccountLabel: "me@gmail.com",
            },
          ]
        : [],
    ),
    listMessages: vi.fn(async () => [
      {
        id: "1",
        subject: "Mail in My Day",
        sender: null,
        receivedAt: null,
        webLink: null,
      },
    ]),
    sendMail: vi.fn(),
    listEvents: vi.fn(async () => []),
    createCalendarEvent: vi.fn(),
  };
}
it("renders connected inbox and opens composer", async () => {
  render(<MyDayWidgetsSection personalIntegrations={service()} />);
  expect(await screen.findByText("Mail in My Day")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo correo" }));
  expect(
    await screen.findByRole("dialog", { name: "Nuevo correo" }),
  ).toBeInTheDocument();
});
it("hides mail without connected account without rewriting saved layout", async () => {
  const preferences = {
    getMyDayWidgets: vi.fn(async () => ({
      version: 1,
      widgets: [{ id: "mail", kind: "mail" }],
    })),
    saveMyDayWidgets: vi.fn(),
  };
  render(
    <MyDayWidgetsSection
      personalIntegrations={service(false)}
      userPreferences={preferences as never}
    />,
  );
  await waitFor(() => expect(preferences.getMyDayWidgets).toHaveBeenCalled());
  expect(screen.queryByTestId("my-day-widget-mail")).not.toBeInTheDocument();
  expect(preferences.saveMyDayWidgets).not.toHaveBeenCalled();
});
it("offers inbox restoration for existing layouts and disables at twelve widgets", async () => {
  const preferences = {
    getMyDayWidgets: vi.fn(async () => ({
      version: 1,
      widgets: Array.from({ length: 12 }, (_, i) => ({
        id: `agenda_${i}`,
        kind: "agenda",
      })),
    })),
    saveMyDayWidgets: vi.fn(),
  };
  render(
    <MyDayWidgetsSection
      personalIntegrations={service()}
      userPreferences={preferences as never}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Mostrar correos" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Agregar widget" })).toBeDisabled();
});
it("shows connection lookup failure outside hidden mail card", async () => {
  const client = service(false);
  client.listConnections.mockRejectedValue(new Error("offline"));
  render(<MyDayWidgetsSection personalIntegrations={client} />);
  expect(
    await screen.findByText(
      "No pudimos comprobar tus conexiones de correo. Reintenta.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Reintentar correos" }),
  ).toBeEnabled();
});
it("surfaces reconnection guidance even when no mailbox is connected", async () => {
  const client = service(false);
  client.listConnections.mockResolvedValue([
    {
      provider: "gmail",
      status: "reconnect_required",
      externalAccountLabel: "me@gmail.com",
    },
  ]);
  render(<MyDayWidgetsSection personalIntegrations={client} />);
  expect(
    await screen.findByText("Vuelve a conectar Gmail para ver tus correos."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Revisar conexiones" }),
  ).toHaveAttribute("href", "/my-integrations");
});
