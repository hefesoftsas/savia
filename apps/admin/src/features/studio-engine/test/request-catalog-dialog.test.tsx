import { cleanup, screen, fireEvent } from "@testing-library/react";
import { render } from "./locale-test-render";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { RequestCatalogDialog } from "../request-catalog-dialog";
import { requestPageSchema } from "@savia/studio-shared/request-page";
const request = vi.hoisted(() => vi.fn());
vi.mock("../request-page-api", () => ({ requestPageApi: request }));
afterEach(cleanup);
it("loads the catalog and requires mapping before connecting without executing", async () => {
  request.mockResolvedValue({
    paths: {
      "/api/flows/new-request/runs": {
        post: {
          operationId: "execute_new",
          summary: "Nuevo request",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    input: { properties: { plate: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const config = requestPageSchema.parse({
    version: 1,
    source: "savia-request",
    actions: [
      {
        id: "existing",
        operationId: "existing",
        label: "Actual",
        kind: "submit",
        input: {},
        output: {},
      },
    ],
  });
  const onAdd = vi.fn();
  render(
    <RequestCatalogDialog
      config={config}
      fields={{ vehicle_plate: { label: "Placa" } }}
      onAdd={onAdd}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Agregar request" }));
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Request disponible" }),
    { target: { value: "new-request" } },
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Conectar request",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Conectar plate" }), {
    target: { value: "vehicle_plate" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Conectar request" }));
  expect(onAdd.mock.calls[0][0].actions[1]).toMatchObject({
    id: "new-request",
    operationId: "execute_new",
    kind: "submit",
    input: { plate: "vehicle_plate" },
  });
  expect(request).toHaveBeenCalledExactlyOnceWith("/openapi.json");
});

it("uses the compact editor control for adding a request", () => {
  render(
    <RequestCatalogDialog
      config={requestPageSchema.parse({
        version: 1,
        source: "savia-request",
        actions: [
          {
            id: "existing",
            operationId: "existing",
            label: "Actual",
            kind: "submit",
            input: {},
            output: {},
          },
        ],
      })}
      fields={{}}
      onAdd={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Agregar request" }).className,
  ).toContain("size-8");
});

it("marks the add-request action with the theme plus icon", () => {
  render(
    <RequestCatalogDialog
      config={requestPageSchema.parse({
        version: 1,
        source: "savia-request",
        actions: [
          {
            id: "existing",
            operationId: "existing",
            label: "Actual",
            kind: "submit",
            input: {},
            output: {},
          },
        ],
      })}
      fields={{}}
      onAdd={vi.fn()}
    />,
  );

  const addRequest = screen.getByRole("button", { name: "Agregar request" });
  expect(addRequest.querySelector(".lucide-plus")).not.toBeNull();
  expect(addRequest.querySelector(".text-primary")).not.toBeNull();
});

it("uses an icon-only add action with an explanatory tooltip", async () => {
  const user = userEvent.setup();
  render(
    <RequestCatalogDialog
      config={requestPageSchema.parse({
        version: 1,
        source: "savia-request",
        actions: [
          {
            id: "existing",
            operationId: "existing",
            label: "Actual",
            kind: "submit",
            input: {},
            output: {},
          },
        ],
      })}
      fields={{}}
      onAdd={vi.fn()}
    />,
  );

  const addRequest = screen.getByRole("button", { name: "Agregar request" });
  expect(addRequest.textContent).toBe("");
  await user.hover(addRequest);
  expect((await screen.findByRole("tooltip")).textContent).toContain(
    "Agregar request",
  );
});
