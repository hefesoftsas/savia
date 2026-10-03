import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useLocaleState } from "ra-core";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../studio-engine/test/locale-test-render";
import { WidgetCard } from "./widgets";

afterEach(cleanup);

function LocaleControls() {
  const [, setLocale] = useLocaleState();
  return (
    <>
      <button type="button" onClick={() => setLocale("en")}>
        EN
      </button>
      <button type="button" onClick={() => setLocale("pt")}>
        PT
      </button>
      <WidgetCard
        apiClient={undefined}
        widget={{ id: "agenda", kind: "agenda", title: "My calendar" } as never}
        collectionLabel="My calendar"
        onRemove={() => {}}
        onMove={() => {}}
        isFirst
        isLast
        disabled={false}
      />
    </>
  );
}

describe("widget localization", () => {
  it("updates system copy while preserving the saved widget title", () => {
    render(<LocaleControls />);

    expect(
      screen.getByText("Conecta tu calendario para ver tu agenda aquí."),
    ).toBeVisible();
    expect(screen.getByText("My calendar")).toBeVisible();
    fireEvent.click(screen.getByText("EN"));
    expect(
      screen.getByText("Connect your calendar to see your agenda here."),
    ).toBeVisible();
    expect(screen.getByText("My calendar")).toBeVisible();
    fireEvent.click(screen.getByText("PT"));
    expect(
      screen.getByText("Conecte seu calendário para ver sua agenda aqui."),
    ).toBeVisible();
    expect(screen.getByText("My calendar")).toBeVisible();
  });
});
