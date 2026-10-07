// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "./locale-test-render";
import RecordWorkflowAction from "../record-workflow-action";
import { api } from "../api";

vi.mock("../api", () => ({ api: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("loads manual flows on demand and runs one with record context", async () => {
  vi.mocked(api).mockImplementation(async (url, method, data: any) => {
    if (url === "/workflows")
      return {
        data: [
          {
            id: "flow-1",
            name: "Notify owner",
            enabled: 1,
            definition: { trigger: { type: "manual" }, nodes: [] },
            publishedTrigger: "manual",
          },
          {
            id: "flow-2",
            name: "On create",
            enabled: 1,
            definition: {
              trigger: { type: "created", collection: "requests" },
              nodes: [],
            },
            publishedTrigger: "created",
          },
          {
            id: "flow-3",
            name: "Unpublished manual draft",
            enabled: 1,
            definition: { trigger: { type: "manual" }, nodes: [] },
            publishedTrigger: "created",
          },
        ],
      };
    if (url === "/workflows/flow-1/start" && method === "POST")
      return { data: { id: "run-1" } };
    return { data: null };
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordWorkflowAction collection="requests" recordId="rec-9" />
    </QueryClientProvider>,
  );
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ejecutar flujo…" }));
  expect(await screen.findByText("Notify owner")).toBeInTheDocument();
  expect(screen.queryByText("On create")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Unpublished manual draft"),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Flujo manual para este registro"), {
    target: { value: "flow-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ejecutar" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/workflows/flow-1/start",
      "POST",
      expect.objectContaining({
        data: { collection: "requests", record_id: "rec-9" },
      }),
    ),
  );
  expect(
    await screen.findByText(
      "Ejecución enviada. Consulta su estado en el historial.",
    ),
  ).toBeInTheDocument();
});

it("ignores non-list workflow responses", async () => {
  vi.mocked(api).mockResolvedValue({ data: { record: { id: "rec-9" } } });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordWorkflowAction collection="requests" recordId="rec-9" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ejecutar flujo…" }));
  expect(await screen.findByText("Sin flujos manuales.")).toBeInTheDocument();
});
