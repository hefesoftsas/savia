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

it("runs a manual flow from the record with collection context", async () => {
  vi.mocked(api).mockImplementation(async (url, method, data: any) => {
    if (url === "/workflows")
      return {
        data: [
          {
            id: "flow-1",
            name: "Notify owner",
            enabled: 1,
            definition: { trigger: { type: "manual" }, nodes: [] },
          },
          {
            id: "flow-2",
            name: "On create",
            enabled: 1,
            definition: { trigger: { type: "created", collection: "requests" }, nodes: [] },
          },
        ],
      };
    if (url === "/workflows/flow-1/start" && method === "POST") return { data: { id: "run-1" } };
    return { data: null };
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordWorkflowAction collection="requests" recordId="rec-9" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Notify owner")).toBeInTheDocument();
  expect(screen.queryByText("On create")).not.toBeInTheDocument();
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
  expect(await screen.findByText("Ejecución enviada. Consulta su estado en el historial.")).toBeInTheDocument();
});
