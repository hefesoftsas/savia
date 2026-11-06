import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { makeConfig } from "@savia/studio-shared/metadata";
import { api } from "../api";
import { PipelineColumn } from "../records";
import { setStudioRuntime } from "../runtime";
import { createStudioQueryClient } from "../studio-query-cache";
import { render as renderWithLocale } from "./locale-test-render";

vi.mock("../api", () => ({ api: vi.fn() }));

const object = {
  name: "pipeline_quotes",
  label: "Quotes",
  description: "",
  config: {
    ...makeConfig({
      name: { type: "Textbox", label: "Name" },
      stage: {
        type: "Dropdown",
        label: "Stage",
        options: [{ value: "open", label: "Open" }],
      },
    }),
    studio: { pipeline: { field: "stage" } },
  },
};
const settings = {
  q: "",
  searchField: "",
  stage: "",
  filters: { logic: "and" as const, conditions: [] },
  columns: ["name"],
  columnOrder: ["name"],
  columnAliases: {},
  sort: { field: "name", order: "ASC" as const },
  group: "",
  mode: "pipeline" as const,
  perPage: 25,
};
const record = { id: "quote-1", name: "Draft", stage: "" };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  setStudioRuntime({});
});

function mount(client = createStudioQueryClient()) {
  renderWithLocale(
    <QueryClientProvider client={client}>
      <PipelineColumn
        object={object}
        settings={settings}
        stage=""
        label="Sin etapa"
        onOpen={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return client;
}

it("keeps a loaded pipeline card visible when a same-scope refresh fails transiently", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ data: [record], total: 1 })
    .mockRejectedValueOnce(new Error("Temporary pipeline refresh failure"));
  const client = mount();
  expect(await screen.findByLabelText("Etapa de Draft")).toBeVisible();

  void client.invalidateQueries({ queryKey: ["pipeline", "pipeline_quotes"] });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Temporary pipeline refresh failure",
  );
  expect(screen.getByLabelText("Etapa de Draft")).toBeVisible();
});

it("removes a cached pipeline card after same-scope authorization is denied", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ data: [record], total: 1 })
    .mockRejectedValueOnce(
      Object.assign(new Error("Pipeline access revoked"), { status: 403 }),
    );
  const client = mount();
  expect(await screen.findByLabelText("Etapa de Draft")).toBeVisible();

  void client.invalidateQueries({ queryKey: ["pipeline", "pipeline_quotes"] });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Pipeline access revoked",
  );
  await waitFor(() =>
    expect(
      client.getQueryCache().findAll({
        queryKey: ["pipeline", "pipeline_quotes"],
      })[0]?.state.data,
    ).toBeUndefined(),
  );
  expect(screen.queryByLabelText("Etapa de Draft")).not.toBeInTheDocument();
});
