// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectionOptionField } from "../collection-option-field";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
afterEach(cleanup);
it("renders a label for a numeric foreign key without changing the existing value", async () => {
  vi.mocked(api).mockResolvedValue({
    data: [{ value: "2", label: "Agencia de prueba" }],
    hasNext: false,
  });
  const change = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CollectionOptionField
        objectName="customers"
        numeric
        fieldName="agency"
        value={2}
        setFieldValue={change}
        config={{
          collectionOptions: {
            domain: "agency-network",
            collection: "agency-profiles",
            valueField: "id",
            labelField: "attributes.organization.displayName",
          },
        }}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Agencia de prueba");
  expect(change).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith(
    "/collection-options/customers/agency?page=1",
  );
});
it("preserves an existing value absent from the catalog", async () => {
  vi.mocked(api).mockResolvedValue({
    data: [{ value: "cc", label: "C.C." }],
    hasNext: false,
  });
  const change = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CollectionOptionField
        objectName="customers"
        numeric={false}
        fieldName="document"
        value="TEST"
        setFieldValue={change}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText("Valor actual: TEST")).toBeTruthy(),
  );
  expect(change).not.toHaveBeenCalled();
});
