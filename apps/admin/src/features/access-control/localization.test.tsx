import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  I18nContextProvider,
  StoreContextProvider,
  memoryStore,
  useSetLocale,
} from "ra-core";
import { PredicateEditor } from "./grant-editor";
function context() {
  let locale = "en";
  return {
    translate: (key: string) => key,
    changeLocale: async (next: string) => {
      locale = next;
    },
    getLocale: () => locale,
  };
}
function Switcher() {
  const setLocale = useSetLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>ES</button>
      <button onClick={() => setLocale("pt")}>PT</button>
    </>
  );
}
afterEach(cleanup);
it("switches permission controls between English, Spanish and Portuguese", async () => {
  render(
    <StoreContextProvider value={memoryStore()}>
      <I18nContextProvider value={context()}>
        <Switcher />
        <PredicateEditor
          value={{ all: true }}
          onChange={() => {}}
          entry={{
            resource: "collection:people",
            label: "People",
            fields: [],
            actions: ["read"],
            creatorSupported: true,
            fieldTypes: {},
            restricted: false,
          }}
        />
      </I18nContextProvider>
    </StoreContextProvider>,
  );
  expect(screen.getByRole("option", { name: "All records" })).toBeTruthy();
  fireEvent.click(screen.getByText("ES"));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Todos los registros" }),
    ).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("PT"));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Todos os registros" }),
    ).toBeTruthy(),
  );
});
