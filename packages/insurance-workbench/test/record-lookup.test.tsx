// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { RecordLookup } from "../src/record-lookup";
import { RecordEditor } from "../src/editor";
import type { WorkbenchConfig } from "../src/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mapping = {
  collection: "customers",
  labelField: "display_name",
  searchFields: ["display_name", "email"],
  idField: "customer_id",
  filter: { field: "active", value: true },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function api(list: ReturnType<typeof vi.fn>) {
  const collections = new Map<string, { describe: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }>();
  const collection = (name: string) => {
    let item = collections.get(name);
    if (!item) {
      item = {
        describe: vi.fn(async () => name === "policies"
          ? { name, config: { fields: {
              customer_name: { type: "Textbox", label: "Customer", config: { pluginLookup: mapping } },
              customer_id: { type: "Textbox", label: "Customer ID" },
              notes: { type: "Textbox", label: "Notes" },
            } } }
          : { name, config: { fields: { display_name: { type: "Textbox" }, email: { type: "Email" }, active: { type: "Toggle" } } } }),
        list: name === "customers" ? list : vi.fn().mockResolvedValue({ data: [], total: 0 }),
        create: vi.fn().mockResolvedValue({ id: "new-policy" }),
        update: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({ id: "p1", _version: 4 }),
      };
      collections.set(name, item);
    }
    return item;
  };
  return { collection, savia: { collections: { collection } } as unknown as PluginApi };
}

it("searches paginated options with the configured fields and filter, then selects the label and ID together", async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ data: [{ id: "c1", display_name: "Acme" }], total: 21 })
    .mockResolvedValueOnce({ data: [{ id: "c2", display_name: "Beacon" }], total: 21 });
  const a = api(list);
  const onSelect = vi.fn();
  render(<RecordLookup savia={a.savia} mapping={mapping} fieldKey="customer_name" label="Customer" snapshot="" referenceId="" t={(caption) => caption} onSelect={onSelect} onClear={vi.fn()} />);
  const input = screen.getByRole("combobox", { name: "Customer" });
  fireEvent.focus(input);
  await screen.findByRole("option", { name: "Acme" });
  expect(list).toHaveBeenCalledWith({
    q: undefined,
    searchFields: ["display_name", "email"],
    page: 1,
    perPage: 20,
    sort: "display_name",
    order: "ASC",
    filters: { conditions: [{ field: "active", op: "eq", value: true }] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
  await screen.findByRole("option", { name: "Beacon" });
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, perPage: 20 }));
  fireEvent.focus(input);
  expect(screen.getByRole("option", { name: "Beacon" })).toBeInTheDocument();
  expect(screen.queryByText("Buscando referencias…")).not.toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("option", { name: "Beacon" }));
  expect(onSelect).toHaveBeenCalledWith("c2", "Beacon");
});

it("supports a boolean label field", async () => {
  const list = vi.fn().mockResolvedValue({ data: [{ id: "c-true", display_name: true }], total: 1 });
  const onSelect = vi.fn();
  const a = api(list);
  render(<RecordLookup savia={a.savia} mapping={mapping} fieldKey="customer_name" label="Customer" snapshot="" referenceId="" t={(caption) => caption} onSelect={onSelect} onClear={vi.fn()} />);
  fireEvent.focus(screen.getByRole("combobox", { name: "Customer" }));
  fireEvent.click(await screen.findByRole("option", { name: "true" }));
  expect(onSelect).toHaveBeenCalledWith("c-true", "true");
});

it("ignores stale results after the query changes and provides an explicit retry on error", async () => {
  const first = deferred<{ data: { id: string; display_name: string }[]; total: number }>();
  const list = vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValueOnce({ data: [{ id: "c3", display_name: "Current result" }], total: 1 });
  const a = api(list);
  render(<RecordLookup savia={a.savia} mapping={mapping} fieldKey="customer_name" label="Customer" snapshot="Legacy text" referenceId="old-id" t={(caption) => caption} onSelect={vi.fn()} onClear={vi.fn()} />);
  const input = screen.getByRole("combobox", { name: "Customer" });
  fireEvent.focus(input);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "current" } });
  await screen.findByRole("alert");
  expect(screen.queryByRole("option", { name: "Old result" })).not.toBeInTheDocument();
  await act(async () => first.resolve({ data: [{ id: "old", display_name: "Old result" }], total: 1 }));
  expect(screen.queryByRole("option", { name: "Old result" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("option", { name: "Current result" });
});

const config = {
  title: "Policies", description: "Policies", singular: "Policy", object: "policies", createLabel: "New policy",
  defaults: { customer_name: "", customer_id: null, notes: "" },
  fields: [
    { key: "customer_name", label: "Customer", lookup: true },
    { key: "notes", label: "Notes" },
  ],
  columns: [], metrics: () => [], matches: () => true, validate: () => null, exportHeaders: [], exportRow: () => [], filters: [], stages: [],
} as unknown as WorkbenchConfig;

it("saves a selected lookup snapshot and ID in one create patch", async () => {
  const list = vi.fn().mockResolvedValue({ data: [{ id: "c1", display_name: "Acme Ltd" }], total: 1 });
  const a = api(list);
  render(<RecordEditor config={config} record={null} savia={a.savia} onClose={vi.fn()} onSaved={vi.fn()} />);
  const input = await screen.findByRole("combobox", { name: "Customer" });
  expect(list).not.toHaveBeenCalled();
  fireEvent.focus(input);
  fireEvent.click(await screen.findByRole("option", { name: "Acme Ltd" }));
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Review" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(a.collection("policies").create).toHaveBeenCalledWith({
    customer_name: "Acme Ltd", customer_id: "c1", notes: "Review",
  }));
});

it("preserves a legacy text snapshot and null ID on an unrelated edit", async () => {
  const list = vi.fn();
  const a = api(list);
  const record = { id: "p1", _version: 4, customer_name: "Legacy customer", customer_id: null, notes: "Before" };
  render(<RecordEditor config={config} record={record} savia={a.savia} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(await screen.findByText("Legacy customer")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "After" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(a.collection("policies").update).toHaveBeenCalledWith("p1", {
    customer_name: "Legacy customer", customer_id: null, notes: "After",
  }, { version: 4 }));
  expect(list).not.toHaveBeenCalled();
});
