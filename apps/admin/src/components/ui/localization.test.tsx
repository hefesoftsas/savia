import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StoreContextProvider, memoryStore, useSetLocale } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "./pagination";

function SharedControls() {
  const setLocale = useSetLocale();
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>Business record</DialogTitle>
        <DialogDescription>Customer supplied description</DialogDescription>
        <input aria-label="Business value" defaultValue="Unsaved value" />
        <button onClick={() => setLocale("es")}>ES</button>
        <button onClick={() => setLocale("pt")}>PT</button>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#previous" />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#next" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </DialogContent>
    </Dialog>
  );
}

afterEach(cleanup);
it("switches dialog and pagination accessible labels through EN, ES and PT without replacing the open dialog", async () => {
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <SharedControls />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "pagination" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Go to previous page" }),
  ).toHaveAttribute("href", "#previous");
  expect(
    screen.getByRole("link", { name: "Go to next page" }),
  ).toHaveTextContent("Next");
  fireEvent.change(screen.getByLabelText("Business value"), {
    target: { value: "Customer draft" },
  });
  fireEvent.click(screen.getByText("ES"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeVisible(),
  );
  expect(screen.getByRole("navigation", { name: "Paginación" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Ir a la página anterior" }),
  ).toHaveTextContent("Anterior");
  expect(
    screen.getByRole("link", { name: "Ir a la página siguiente" }),
  ).toHaveTextContent("Siguiente");
  fireEvent.click(screen.getByText("PT"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Fechar" })).toBeVisible(),
  );
  expect(screen.getByRole("navigation", { name: "Paginação" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Ir para a página anterior" }),
  ).toHaveTextContent("Anterior");
  expect(
    screen.getByRole("link", { name: "Ir para a próxima página" }),
  ).toHaveTextContent("Próxima");
  expect(screen.getByLabelText("Business value")).toHaveValue("Customer draft");
  fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
