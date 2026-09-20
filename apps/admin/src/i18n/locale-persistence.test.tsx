import { afterEach, describe, expect, it } from "vitest";
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
import { LocalePersistenceSync } from "./locale-persistence-sync";
import {
  APP_LOCALE_STORAGE_KEY,
  resolveInitialAppLocale,
} from "./locale-storage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function LocaleSwitcher() {
  const [locale, setLocale] = useLocaleState();
  return (
    <>
      <span data-testid="current-locale">{locale}</span>
      <button onClick={() => setLocale("en")}>EN</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}

function Harness({ store }: { store: ReturnType<typeof memoryStore> }) {
  const i18nProvider = useAppI18nProvider();
  return (
    <CoreAdminContext
      store={store}
      dataProvider={testDataProvider()}
      i18nProvider={i18nProvider}
    >
      <LocalePersistenceSync />
      <LocaleSwitcher />
    </CoreAdminContext>
  );
}

describe("locale persistence", () => {
  it("writes the selected language to localStorage", async () => {
    const store = memoryStore({ locale: "es" });
    render(
      <StoreContextProvider value={store}>
        <Harness store={store} />
      </StoreContextProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() =>
      expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("en"),
    );

    fireEvent.click(screen.getByRole("button", { name: "PT" }));
    await waitFor(() =>
      expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("pt"),
    );
  });

  it("restores the stored language for a new session store", async () => {
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, "pt");
    expect(resolveInitialAppLocale()).toBe("pt");

    const reloadedStore = memoryStore({ locale: resolveInitialAppLocale() });
    render(
      <StoreContextProvider value={reloadedStore}>
        <Harness store={reloadedStore} />
      </StoreContextProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("current-locale")).toHaveTextContent("pt"),
    );
  });
});
