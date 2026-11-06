import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContextProvider, memoryStore, useLocaleState } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  QuickTaskWidgetBody,
  useMyDayAgenda,
  formatDay,
} from "./agenda-widget";
function Example() {
  const agenda = useMyDayAgenda();
  const [, setLocale] = useLocaleState();
  return (
    <>
      <p>{agenda.feedback}</p>
      <button
        onClick={() =>
          agenda.setFeedback({
            key: "No se pudo sincronizar %{providers}.",
            params: { providers: ["Google Calendar", "Outlook"] },
          })
        }
      >
        WARN
      </button>
      <button onClick={() => setLocale("en")}>EN</button>
      <button onClick={() => setLocale("pt")}>PT</button>
      <QuickTaskWidgetBody agenda={agenda} />
    </>
  );
}
afterEach(cleanup);
describe("agenda localization", () => {
  it("localizes connection failures without repeating the request", async () => {
    const api = {
      listConnections: vi.fn().mockRejectedValue(new Error("Network failure")),
      listEvents: vi.fn(),
      createCalendarEvent: vi.fn(),
    };
    const store = memoryStore({ locale: "es" });
    const { result } = renderHook(() => useMyDayAgenda(api), {
      wrapper: ({ children }) => (
        <StoreContextProvider value={store}>
          <AppLocaleProvider>{children}</AppLocaleProvider>
        </StoreContextProvider>
      ),
    });
    await waitFor(() =>
      expect(result.current.feedback).toBe(
        "No pudimos sincronizar tus agendas.",
      ),
    );
    act(() => store.setItem("locale", "en"));
    expect(result.current.feedback).toBe("We could not sync your calendars.");
    expect(api.listConnections).toHaveBeenCalledTimes(1);
  });

  it("switches task labels without losing the draft", () => {
    render(
      <StoreContextProvider value={memoryStore({ locale: "es" })}>
        <AppLocaleProvider>
          <Example />
        </AppLocaleProvider>
      </StoreContextProvider>,
    );
    fireEvent.change(screen.getByLabelText("Tarea"), {
      target: { value: "My draft" },
    });
    fireEvent.click(screen.getByText("WARN"));
    expect(
      screen.getByText("No se pudo sincronizar Google Calendar y Outlook."),
    ).toBeVisible();
    fireEvent.click(screen.getByText("EN"));
    expect(
      screen.getByText("Could not sync Google Calendar and Outlook."),
    ).toBeVisible();
    expect(screen.getByLabelText("Task")).toHaveValue("My draft");
    expect(screen.getByRole("button", { name: "Create task" })).toBeVisible();
    fireEvent.click(screen.getByText("PT"));
    expect(
      screen.getByText(
        "Não foi possível sincronizar Google Calendar e Outlook.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Tarefa")).toHaveValue("My draft");
    expect(screen.getByRole("button", { name: "Criar tarefa" })).toBeVisible();
  });
  it("formats day captions with the selected locale", () => {
    const date = new Date(2026, 9, 3, 12);
    expect(formatDay(date, "en")).toContain("October");
    expect(formatDay(date, "pt")).toContain("outubro");
  });
});
