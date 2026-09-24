import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { render } from "./locale-test-render";
import { afterEach, expect, it, vi } from "vitest";
import RequestPageGenerator from "../request-page-generator";

const request = vi.hoisted(() => vi.fn());

vi.mock("../request-page-api", () => ({ requestPageApi: request }));

afterEach(() => {
  cleanup();
  request.mockReset();
});

const catalog = {
  paths: {
    "/api/flows/quote/runs": {
      post: {
        operationId: "execute_quote",
        summary: "Cotizar auto",
        "x-savia-kind": "request",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  input: {
                    properties: {
                      "auto_light.vehicle.plate": { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/flows/vehicle-by-plate/runs": {
      post: {
        operationId: "execute_vehicle_by_plate",
        summary: "Consultar vehículo por placa",
        "x-savia-kind": "lookup",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  input: {
                    properties: {
                      plate: {
                        type: "string",
                        "x-savia-field": {
                          bind: "auto_light.vehicle.plate",
                          output: { year: "/data/vehicle/year" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

it("keeps lookups out of submit operations and reports the selected operation", async () => {
  request.mockResolvedValue(catalog);

  render(<RequestPageGenerator onCreated={vi.fn(async () => undefined)} />);

  const submitOperations = await screen.findByRole("group", {
    name: "Operaciones al enviar el formulario",
  });
  const lookups = screen.getByRole("group", {
    name: "Consultas para completar campos",
  });

  expect(
    within(submitOperations).queryByText("Consultar vehículo por placa"),
  ).not.toBeInTheDocument();
  expect(
    within(lookups).getByText("Consultar vehículo por placa"),
  ).toBeInTheDocument();
  expect(submitOperations.querySelector(".max-h-52")).toBeInTheDocument();
  expect(screen.getByRole("status").parentElement).not.toHaveClass("sticky");

  fireEvent.click(
    within(submitOperations).getByText("Cotizar auto").closest("label")!,
  );

  expect(screen.getByRole("status")).toHaveTextContent(
    "1 operación seleccionada",
  );
  expect(screen.getByRole("button", { name: "Generar página" })).toBeEnabled();
});

it("requires a selected operation that provides the lookup field", async () => {
  request.mockResolvedValue(catalog);

  render(<RequestPageGenerator onCreated={vi.fn(async () => undefined)} />);

  const submitOperations = await screen.findByRole("group", {
    name: "Operaciones al enviar el formulario",
  });
  const lookup = screen
    .getByText("Consultar vehículo por placa")
    .closest("label")!
    .querySelector("input") as HTMLInputElement;

  expect(lookup).toBeDisabled();

  const quote = within(submitOperations)
    .getByText("Cotizar auto")
    .closest("label")!;
  fireEvent.click(quote);
  expect(lookup).toBeEnabled();

  fireEvent.click(lookup);
  expect(lookup).toBeChecked();
  fireEvent.click(quote);

  await waitFor(() => expect(lookup).not.toBeChecked());
});
