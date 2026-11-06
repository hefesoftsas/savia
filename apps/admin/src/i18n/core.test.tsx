import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreContextProvider, memoryStore, useLocaleState } from "ra-core";
import { AppLocaleProvider } from "./app-locale-provider";
import { useState } from "react";
import { intlLocale, translateMessage, useMessages } from "./core";

const messages = {
  save: ["Guardar", "Save", "Salvar"],
  count: ["%{count} registros", "%{count} records", "%{count} registros"],
} as const;
function Editor() {
  const t = useMessages(messages);
  const [, setLocale] = useLocaleState();
  const [value, setValue] = useState("Save");
  return (
    <>
      <input
        aria-label="User content"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button>{t("save")}</button>
      <p>{t("count", { count: 2 })}</p>
      <button onClick={() => setLocale("en")}>EN</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}
describe("core localization", () => {
  it("switches mounted copy without rewriting user input or resetting edits", async () => {
    render(
      <StoreContextProvider value={memoryStore()}>
        <AppLocaleProvider>
          <Editor />
        </AppLocaleProvider>
      </StoreContextProvider>,
    );
    expect(screen.getByRole("button", { name: "Guardar" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Guardar <b>custom</b>" },
    });
    fireEvent.click(screen.getByText("EN"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeVisible(),
    );
    expect(screen.getByText("2 records")).toBeVisible();
    fireEvent.click(screen.getByText("PT"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvar" })).toBeVisible(),
    );
    expect(screen.getByRole("textbox")).toHaveValue("Guardar <b>custom</b>");
  });
  it("uses explicit locales and substitutes values without recursively interpreting them", () => {
    expect(translateMessage(messages, "save", "pt")).toBe("Salvar");
    expect(
      translateMessage(messages, "count", "en", { count: "%{save}" }),
    ).toBe("%{save} records");
    expect(intlLocale("en")).toBe("en-US");
    expect(intlLocale("pt")).toBe("pt-BR");
    expect(intlLocale("es")).toBe("es-CO");
  });
});
