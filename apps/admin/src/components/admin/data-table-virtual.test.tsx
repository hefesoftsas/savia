import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CoreAdminContext, ListContextProvider } from "ra-core";
import { DataTable } from "./data-table";
const rows = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  name: `Person ${i}`,
}));
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        width: 800,
        height: this.tagName === "TR" ? 40 : 400,
        top: 0,
        left: 0,
        right: 800,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON() {},
      };
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.tagName === "TR" ? 40 : 400;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("bounds mounted rows and renders distant rows after scrolling", async () => {
  const opened = vi.fn(() => false as const);
  const { container } = render(
    <CoreAdminContext>
      <ListContextProvider
        value={
          {
            data: rows,
            total: 200,
            isPending: false,
            isLoading: false,
            selectedIds: [],
            onSelect: () => {},
            onToggleItem: () => {},
            sort: { field: "id", order: "ASC" },
            setSort: () => {},
            resource: "people",
          } as never
        }
      >
        <DataTable
          resource="people"
          virtualize
          bulkActionButtons={false}
          rowClick={opened}
        >
          <DataTable.Col source="name" />
        </DataTable>
      </ListContextProvider>
    </CoreAdminContext>,
  );
  await screen.findByText("Person 0");
  expect(
    container.querySelectorAll("tbody tr[data-index]").length,
  ).toBeGreaterThan(0);
  expect(
    container.querySelectorAll("tbody tr[data-index]").length,
  ).toBeLessThan(35);
  expect(screen.queryByText("Person 199")).not.toBeInTheDocument();
  const viewport = container.querySelector('[data-slot="table-container"]')!;
  fireEvent.scroll(viewport, { target: { scrollTop: 7000 } });
  await waitFor(() =>
    expect(screen.queryByText("Person 175")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByText("Person 175"));
  await waitFor(() =>
    expect(opened).toHaveBeenCalledWith(175, "people", rows[175]),
  );
});
it("keeps all rows in the default non-virtual table", () => {
  const { container } = render(
    <CoreAdminContext>
      <DataTable
        resource="people"
        data={rows}
        total={200}
        isPending={false}
        bulkActionButtons={false}
      >
        <DataTable.Col source="name" />
      </DataTable>
    </CoreAdminContext>,
  );
  expect(container.querySelectorAll("tbody tr")).toHaveLength(200);
});

it("keeps a focused record mounted when an update moves it outside the viewport", async () => {
  const table = (data: typeof rows) => (
    <CoreAdminContext>
      <DataTable
        resource="people"
        data={data}
        total={200}
        isPending={false}
        virtualize
        bulkActionButtons={false}
      >
        <DataTable.Col source="name" />
      </DataTable>
    </CoreAdminContext>
  );
  const { rerender } = render(table(rows));
  const row = (await screen.findByText("Person 2")).closest("tr")!;
  fireEvent.focus(row);
  rerender(table([...rows.filter((r) => r.id !== 2), rows[2]]));
  await waitFor(() =>
    expect(screen.getByText("Person 2").closest("tr")).toHaveAttribute(
      "data-index",
      "199",
    ),
  );
});
