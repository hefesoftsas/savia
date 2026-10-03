import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
it("disables adding widgets at twelve widgets without a separate mail shortcut", async () => {
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
  await screen.findByTestId("my-day-widget-agenda_0");
  expect(
    screen.queryByRole("button", { name: "Mostrar correos" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Agregar widget" })).toBeDisabled();
});
it("restores the connected inbox through Add widget and saves the layout", async () => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  const user = userEvent.setup();
  const preferences = {
    getMyDayWidgets: vi.fn(async () => ({ version: 1, widgets: [] })),
    saveMyDayWidgets: vi.fn(async (layout: unknown) => layout),
  };
  render(
    <MyDayWidgetsSection
      personalIntegrations={service()}
      userPreferences={preferences as never}
    />,
  );
  await screen.findByTestId("my-day-widgets-empty");
  await user.click(screen.getByRole("button", { name: "Agregar widget" }));
  const dialog = await screen.findByRole("dialog", { name: "Agregar widget" });
  await user.click(within(dialog).getByRole("button", { name: "Personal" }));
  await user.click(
    within(dialog).getByRole("combobox", { name: "Widget del sistema" }),
  );
  await user.click(screen.getByRole("option", { name: "Bandeja de correo" }));
  await user.click(
    within(dialog).getByRole("button", { name: "Agregar widget" }),
  );
  expect(await screen.findByText("Mail in My Day")).toBeInTheDocument();
  expect(preferences.saveMyDayWidgets).toHaveBeenCalledWith({
    version: 1,
    widgets: [{ id: "mail", kind: "mail" }],
  });
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
