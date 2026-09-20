import { fireEvent, screen, cleanup } from "@testing-library/react";
import { render } from "./studio-test-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { makeConfig, type CrmObject } from "@savia/crm-shared/metadata";
import { RelatedPresentationSettings } from "../related-presentation-settings";
vi.mock("../api", () => ({
  api: vi.fn(async () => ({
    data: [
      {
        id: "rel",
        sourceObject: "parent",
        targetObject: "child",
        storage: "local",
        cardinality: "one-to-many",
      },
    ],
  })),
}));
afterEach(cleanup);
it("configures table presentation and keeps required child fields visible", async () => {
  const child: CrmObject = {
    name: "child",
    label: "Child",
    config: makeConfig({
      name: { type: "Textbox", label: "Nombre", required: true },
      notes: { type: "Textbox", label: "Notas" },
    }),
  };
  const onChange = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RelatedPresentationSettings
        objectName="parent"
        config={{
          collectionRelation: "rel",
          relationPresentation: "table",
          relationFields: ["notes"],
        }}
        objects={[child]}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByLabelText("Nombre (obligatorio)")).toBeDisabled();
  expect(screen.getByLabelText("Nombre (obligatorio)")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Crear registros"));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ relationAllowCreate: false }),
  );
  fireEvent.change(
    screen.getByLabelText("Presentación de registros relacionados"),
    { target: { value: "subform" } },
  );
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      relationPresentation: "subform",
      multiple: true,
    }),
  );
});
