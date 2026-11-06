import { useEffect, useState } from "react";
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  memoryStore,
  StoreContextProvider,
  useLocaleState,
  CoreAdminContext,
  testDataProvider,
} from "ra-core";
import { useAppI18nProvider } from "./app-locale-provider";
import { useMessages } from "./core";

afterEach(cleanup);
const messages = { save: ["Guardar", "Save", "Salvar"] } as const;

it("preserves unsaved state through real CoreAdminContext when switching ES, EN and PT", async () => {
  let mounts = 0;
  function DraftEditor() {
    const [draft, setDraft] = useState("Initial");
    const [, setLocale] = useLocaleState();
    const t = useMessages(messages);
    useEffect(() => {
      mounts += 1;
    }, []);
    return (
      <>
        <input
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button>{t("save")}</button>
        <button onClick={() => setLocale("en")}>EN</button>
        <button onClick={() => setLocale("pt")}>PT</button>
        <button onClick={() => setLocale("es")}>ES</button>
      </>
    );
  }
  const store = memoryStore({ locale: "es" });
  const dataProvider = testDataProvider();
  function LocalizedAdminContext() {
    const i18nProvider = useAppI18nProvider();
    return (
      <CoreAdminContext
        store={store}
        dataProvider={dataProvider}
        i18nProvider={i18nProvider}
      >
        <DraftEditor />
      </CoreAdminContext>
    );
  }
  render(
    <StoreContextProvider value={store}>
      <LocalizedAdminContext />
    </StoreContextProvider>,
  );
  await screen.findByRole("button", { name: "Guardar" });
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
    target: { value: "Unsaved user content" },
  });
  for (const [button, caption] of [
    ["EN", "Save"],
    ["PT", "Salvar"],
    ["ES", "Guardar"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: caption })).toBeVisible(),
    );
    // React-admin's provider effect completes asynchronously; assert after flushing it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "Unsaved user content",
    );
    expect(mounts).toBe(1);
  }
});
